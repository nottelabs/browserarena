import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright-core';
import {parseConfig,planCampaign,type CampaignConfig,PROVIDERS} from './config.js';
import {runCampaign,cleaner} from './run.js';
import {accessProviders} from './providers.js';
import {exportReviewed} from './export.js';
const config:CampaignConfig={schemaVersion:1,rounds:1,providers:['notte'],viewport:{width:800,height:600},viewport_mode:'requested',observation_ms:500,captures_ms:[500],cooldown_ms:0,targets:[{id:'local',domain:'fixture',url:'http://127.0.0.1/',source:'controlled fixture',expected_text:'Ready'}]};
test('campaign planning rejects duplicate slots, unsafe IDs and bad timing before allocation',()=>{
 assert.equal(planCampaign({...config,rounds:3,providers:[...PROVIDERS]}).length,15);
 for(const bad of [{...config,providers:['notte','notte']},{...config,captures_ms:[600,500]},{...config,targets:[{...config.targets[0],id:'../unsafe'}]}])assert.throws(()=>parseConfig(bad));
});
test('all five adapters send the declared settings and never retry provider failures',async()=>{
 for(const provider of PROVIDERS){
  const calls:{url:string;method:string;body:Record<string,unknown>}[]=[];
  const request=(async(input:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(input),method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):{}});return new Response(JSON.stringify({id:'fixture',session_id:'fixture',connectUrl:'ws://fixture',cdp_ws_url:'ws://fixture',websocketUrl:'ws://fixture?x=1',cdpUrl:'https://fixture',cdp_url:'ws://fixture'}),{status:200,headers:{'content-type':'application/json'}});}) as typeof fetch;
  const env={BROWSERBASE_API_KEY:'test',BROWSERBASE_PROJECT_ID:'project',KERNEL_API_KEY:'test',STEEL_API_KEY:'test',BROWSER_USE_API_KEY:'test',NOTTE_API_KEY:'test'};
  const session=await accessProviders(env,request)(provider);assert.equal(session.id,'fixture');await session.release();assert.equal(calls.length,2);
  const body=calls[0].body;
  if(provider==='browserbase'){assert.equal(body.timeout,300);assert.equal((body.browserSettings as {solveCaptchas:boolean}).solveCaptchas,true);}
  if(provider==='steel'){assert.equal(body.timeout,300000);assert.equal(body.solveCaptcha,true);assert.equal(body.useProxy,true);}
  if(provider==='kernel'){assert.equal(body.stealth,true);assert.equal(body.headless,false);}
  if(provider==='browser-use'){assert.equal(body.proxyCountryCode,'us');assert.equal(body.enableRecording,false);}
  if(provider==='notte'){assert.equal(body.solve_captchas,true);assert.equal(body.max_duration_minutes,5);}
  let failed=0;const unavailable=(async()=>{failed++;return new Response('{}',{status:503,headers:{'content-type':'application/json'}});}) as typeof fetch;
  await assert.rejects(accessProviders(env,unavailable)(provider));assert.equal(failed,1);
 }
});
test('ambiguous creates retain the failed slot and halt new allocations without replacement',async t=>{
 const root=await mkdtemp(join(tmpdir(),'access-create-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
 const result=await runCampaign({...config,rounds:3},join(root,'run'),{create:async()=>{calls++;throw Error('create failed');}});
 assert.equal(calls,1);assert.equal(result.rows[0].ownershipUnknown,true);assert.equal(result.complete,false);assert.equal(result.halted,true);
 const completion=JSON.parse(await readFile(join(root,'run','completion.json'),'utf8'));assert.equal(completion.notRun.length,2);
 await assert.rejects(exportReviewed(join(root,'run'),join(root,'public'),'2026-10-28'),/Every planned/);
});
test('real Chromium captures original evidence and screencast; review gates a sanitized export',async t=>{
 const root=await mkdtemp(join(tmpdir(),'access-browser-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const server=http.createServer((_,r)=>r.end('<html><title>Ready</title><body><h1>Ready</h1><script>setInterval(()=>document.body.style.background=document.body.style.background==="white"?"lightblue":"white",50)</script></body></html>'));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
 let released=0;
 const result=await runCampaign({...config,targets:[{...config.targets[0],url}]},join(root,'run'),{
  create:async()=>({id:'private-session-id',cdpUrl:'ws://not-used',configuration:{fixture:true},release:async()=>{released++;}}),
  connect:async()=>{const browser=await chromium.launch();t.after(()=>browser.close());await browser.newContext();return browser;},
 });
 assert.equal(released,1);assert.equal(result.rows[0].status,'captured');assert.equal(result.rows[0].cleanup.disconnected,true);assert.ok(result.rows[0].recording!.frames>0);assert.equal(result.rows[0].recording!.error,null);
 await assert.rejects(exportReviewed(join(root,'run'),join(root,'public'),'2026-10-28'),/reviewed outcome/);
 await writeFile(join(root,'run','review.json'),JSON.stringify([{id:'r1-notte-local',outcome:'accessible',reason:'Controlled Ready heading visible',reviewed:true}]));
 const report=await exportReviewed(join(root,'run'),join(root,'public'),'2026-10-28');
 assert.equal(report.visits.length,1);assert.equal(report.visits[0].replay,null);assert.ok(report.visits[0].screenshot);assert.equal(JSON.stringify(report).includes('private-session-id'),false);
 await assert.rejects(runCampaign(config,join(root,'run')),/EEXIST/);
});
test('release errors halt new visits and still disconnect the owned browser',async t=>{
 const root=await mkdtemp(join(tmpdir(),'access-release-'));t.after(()=>rm(root,{recursive:true,force:true}));let closed=0;
 const result=await runCampaign({...config,rounds:2},join(root,'run'),{
  create:async()=>({id:'owned',cdpUrl:'ws://unused',configuration:{},release:async()=>{throw Error('release failed');}}),
  connect:async()=>({contexts:()=>[],close:async()=>{closed++;}} as unknown as Awaited<ReturnType<typeof chromium.launch>>),
 });
 assert.equal(result.rows.length,1);assert.equal(result.halted,true);assert.equal(closed,1);assert.equal(result.rows[0].cleanup.released,false);assert.equal(result.rows[0].cleanup.disconnected,true);
});
test('exact credentials and CDP URLs are removed from persisted diagnostic text',()=>{
 const clean=cleaner({NOTTE_API_KEY:'private-test-key'});const text=clean('failed private-test-key at wss://example.test?secret=hello');assert.equal(text.includes('private-test-key'),false);assert.equal(text.includes('wss://'),false);
});

for(const failure of ['state','screenshot'] as const)test(`an early ${failure} capture failure survives a successful final capture`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'access-capture-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const result=await runCampaign({...config,captures_ms:[100,500],targets:[{...config.targets[0],url:'data:text/html,<h1>Ready</h1>'}]},join(root,'run'),{
  create:async()=>({id:'owned',cdpUrl:'ws://unused',configuration:{},release:async()=>{}}),
  connect:async()=>{
   const browser=await chromium.launch();t.after(()=>browser.close());const context=await browser.newContext(),page=await context.newPage();
   if(failure==='state'){
    const original=page.evaluate.bind(page);let calls=0;
    page.evaluate=(async(...args:Parameters<typeof page.evaluate>)=>{if(calls++===0)throw Error('controlled state failure');return original(...args);}) as typeof page.evaluate;
   }else{
    const original=page.screenshot.bind(page);let calls=0;
    page.screenshot=async(...args)=>{if(calls++===0)throw Error('controlled screenshot failure');return original(...args);};
   }
   return browser;
  },
 });
 const row=result.rows[0];assert.equal(result.complete,true);assert.equal(row.status,'capture_error');
 assert.match(row.captures[0].error!,/controlled/);assert.equal(row.captures[1].error,undefined);
 assert.ok(row.captures[1].state);assert.ok(row.captures[1].screenshot);
 assert.equal(row.cleanup.released,true);assert.equal(row.cleanup.disconnected,true);
 const persisted=JSON.parse(await readFile(join(root,'run','attempts.jsonl'),'utf8'));
 assert.equal(persisted.status,'capture_error');assert.match(persisted.captures[0].error,/controlled/);
});
