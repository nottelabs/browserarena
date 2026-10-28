import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {chromium,type Browser,type Page} from 'playwright-core';
import {planCampaign,type CampaignConfig,type VisitTask,type AccessProvider} from './config.js';
import {accessProviders,type AccessSession} from './providers.js';
import {bounded,startScreencast,type Recording} from './recording.js';
import {sanitizeErrorMessage} from '../../utils/sanitize.js';
const pause=(ms:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 if(signal?.aborted){reject(signal.reason);return;}
 const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
 const timer=setTimeout(done,Math.max(0,ms));const abort=()=>{clearTimeout(timer);reject(signal?.reason);};signal?.addEventListener('abort',abort,{once:true});
});
export interface Observation {atMs:number;finishedMs:number;screenshot:string|null;state:Record<string,unknown>|null;error?:string}
export interface Attempt {
 id:string;provider:string;site:string;round:number;startedAt:string;finishedAt?:string;navigationAt?:number;
 status:'captured'|'capture_error'|'error'|'interrupted';stage:string;error?:string;sessionId?:string;ownershipUnknown?:boolean;
 configuration?:Record<string,unknown>;documents:{atMs:number;url:string;status:number}[];
 captures:Observation[];recording?:Recording;recordingError?:string;
 cleanup:{released:boolean;disconnected:boolean;errors:string[]};
}
export function cleaner(env=process.env) {
 const secrets=Object.entries(env).filter(([k,v])=>/KEY|TOKEN|SECRET|PASSWORD/.test(k)&&v&&v.length>8).map(([,v])=>v!);
 return (error:unknown)=>{let s=error instanceof Error?error.message:String(error);for(const v of secrets)s=s.split(v).join('[redacted]');return sanitizeErrorMessage(s).slice(0,30000);};
}
export async function runCampaign(config:CampaignConfig,out:string,dependencies:{
 create?:(provider:AccessProvider)=>Promise<AccessSession>; connect?:(url:string)=>Promise<Browser>; signal?:AbortSignal; metadata?:Record<string,unknown>; clean?:(value:unknown)=>string;
}={}) {
 const create=dependencies.create??accessProviders(),connect=dependencies.connect??(url=>chromium.connectOverCDP(url,{timeout:30000}));
 const clean=dependencies.clean??cleaner(),signal=dependencies.signal;let halted=false;
 // Exclusive directory creation prevents overwriting evidence or silently resuming a campaign.
 await mkdir(dirname(out),{recursive:true});await mkdir(out);await mkdir(join(out,'screenshots'));await mkdir(join(out,'observations'));await mkdir(join(out,'recordings'));
 const plan=planCampaign(config),rows:Attempt[]=[];
 const save=(name:string,value:unknown)=>writeFile(join(out,name),JSON.stringify(value,null,2));
 await save('runtime.json',dependencies.metadata??{node:process.version});await save('configuration.json',config);await save('plan.json',plan);
 const journal=(event:Record<string,unknown>)=>appendFile(join(out,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n');
 async function capture(page:Page,task:VisitTask,started:number,ms:number):Promise<Observation> {
  const o:Observation={atMs:Date.now()-started,finishedMs:0,screenshot:null,state:null};
  try {o.state=await bounded(page.evaluate(expected=>{
   const text=document.body?.innerText??'',html=document.documentElement?.outerHTML??'';
   return {url:location.href,title:document.title,text:text.slice(0,30000),textLength:text.length,links:document.links.length,images:document.images.length,
    expectedInText:expected?text.toLowerCase().includes(expected.toLowerCase()):null,expectedInDom:expected?html.toLowerCase().includes(expected.toLowerCase()):null,
    geometry:{innerWidth,innerHeight,outerWidth,outerHeight,screenWidth:screen.width,screenHeight:screen.height,availableWidth:screen.availWidth,availableHeight:screen.availHeight,dpr:devicePixelRatio}};
  },task.target.expected_text??null),10000);
  o.state=JSON.parse(JSON.stringify(o.state,(_,v)=>typeof v==='string'?clean(v):v));
  }catch(e){o.error=clean(e);}
  try {const file=`${task.id}-${ms}ms.jpg`;await page.screenshot({path:join(out,'screenshots',file),type:'jpeg',quality:70,timeout:10000});o.screenshot=file;}catch(e){o.error=[o.error,clean(e)].filter(Boolean).join('; ');}
  o.finishedMs=Date.now()-started;await save(`observations/${task.id}-${ms}ms.json`,o);return o;
 }
 async function attempt(task:VisitTask) {
  const row:Attempt={id:task.id,provider:task.provider,site:task.target.id,round:task.round,startedAt:new Date().toISOString(),status:'error',stage:'create',documents:[],captures:[],cleanup:{released:false,disconnected:false,errors:[]}};
  let createStarted=false;
  let session:AccessSession|undefined,browser:Browser|undefined,stopRecording:(()=>Promise<Recording>)|undefined;
  try {
   await journal({event:'attempt_started',id:task.id});signal?.throwIfAborted();
   // Adapters set request timeouts and disable retries. Ambiguous creates halt further allocation.
   createStarted=true;session=await create(task.provider);row.sessionId=session.id;row.configuration=session.configuration;
   await journal({event:'session_created',id:task.id,sessionId:session.id});
   if(!session.id||!/^wss?:\/\//.test(session.cdpUrl))throw Error('Create returned an invalid session ID or CDP endpoint');
   signal?.throwIfAborted();row.stage='connect';browser=await connect(session.cdpUrl);
   const context=browser.contexts()[0];if(!context)throw Error('Missing browser context');
   const page=context.pages()[0]??await bounded(context.newPage(),10000);
   if(config.viewport_mode==='requested')await bounded(page.setViewportSize(config.viewport),10000);
   row.stage='record';try {stopRecording=await startScreencast(page,join(out,'recordings',task.id));}catch(e){row.recordingError=clean(e);}
   row.stage='observe';const started=Date.now();row.navigationAt=started;
   page.on('response',r=>{try{if(r.request().resourceType()==='document'&&r.frame()===page.mainFrame())row.documents.push({atMs:Date.now()-started,url:clean(r.url()),status:r.status()});}catch{}});
   try {await page.goto(task.target.url,{waitUntil:'domcontentloaded',timeout:Math.min(19000,config.captures_ms[0])});}catch(e){row.error=clean(e);}
   for(const ms of config.captures_ms){await pause(started+ms-Date.now(),signal);row.captures.push(await capture(page,task,started,ms));}
   const final=row.captures.at(-1);row.status=final?.state&&final.screenshot?'captured':'capture_error';
  }catch(e){row.error=clean(e);if(signal?.aborted)row.status='interrupted';if(createStarted&&row.stage==='create'&&!row.sessionId){row.ownershipUnknown=true;halted=true;}}
  finally {
   if(stopRecording)try{row.recording=await stopRecording();}catch(e){row.recordingError=clean(e);}
   if(session?.id)try{await session.release();row.cleanup.released=true;await journal({event:'session_released',id:task.id});}catch(e){row.cleanup.errors.push(clean(e));halted=true;}
   if(browser)try{await bounded(browser.close(),15000);row.cleanup.disconnected=true;}catch(e){row.cleanup.errors.push(clean(e));halted=true;}
   row.finishedAt=new Date().toISOString();rows.push(row);await appendFile(join(out,'attempts.jsonl'),JSON.stringify(row)+'\n');
  }
 }
 try {
  const workers=await Promise.allSettled(config.providers.map(async p=>{try {for(const task of plan.filter(t=>t.provider===p)){
   if(halted||signal?.aborted)break;await attempt(task);if(halted||signal?.aborted)break;await pause(config.cooldown_ms,signal).catch(()=>{});
  }}catch(e){halted=true;throw e;}}));
  const failure=workers.find(w=>w.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
 }finally {
  await save('review.json',plan.map(t=>({id:t.id,outcome:null,reason:'',reviewed:false})));
  await save('completion.json',{complete:rows.length===plan.length,halted,interrupted:signal?.aborted??false,attempted:rows.length,planned:plan.length,notRun:plan.filter(t=>!rows.some(r=>r.id===t.id)).map(t=>t.id)});
 }
 return {rows,halted,complete:rows.length===plan.length};
}
