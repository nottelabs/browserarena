// Scenario-specific settings reproduce the frozen access campaign; lifecycle benchmark defaults stay unchanged.
import Browserbase from '@browserbasehq/sdk';
import Kernel from '@onkernel/sdk';
import Steel from 'steel-sdk';
import type { AccessProvider } from './config.js';
export interface AccessSession {id:string;cdpUrl:string;configuration:Record<string,unknown>;release:()=>Promise<unknown>}
export function accessProviders(env=process.env,request:typeof fetch=fetch) {
 async function api(url:string,method:string,headers:Record<string,string>,body?:unknown,timeout=60000) {
  const r=await request(url,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  if(!r.ok) throw Error(`Provider ${new URL(url).hostname} returned HTTP ${r.status}`);
  const text=await r.text();return text?JSON.parse(text):null;
 }
 return async (provider:AccessProvider):Promise<AccessSession>=>{
  if(provider==='browserbase') {
   const client=new Browserbase({apiKey:env.BROWSERBASE_API_KEY,maxRetries:0,timeout:60000,fetch:request});
   const d=await client.sessions.create({projectId:env.BROWSERBASE_PROJECT_ID!,region:'us-east-1',proxies:[{type:'browserbase',geolocation:{country:'US'}}],api_timeout:300,browserSettings:{solveCaptchas:true,verified:false,viewport:{width:1365,height:900},blockAds:false}});
   return {id:d.id,cdpUrl:d.connectUrl,configuration:{proxy:'US',region:'us-east-1',solveCaptchas:true,verified:false},release:()=>client.sessions.update(d.id,{status:'REQUEST_RELEASE',projectId:env.BROWSERBASE_PROJECT_ID!},{maxRetries:0,timeout:30000})};
  }
  if(provider==='kernel') {
   const client=new Kernel({apiKey:env.KERNEL_API_KEY,maxRetries:0,timeout:60000,fetch:request});
   const d=await client.browsers.create({stealth:true,headless:false,timeout_seconds:300,viewport:{width:1365,height:900}});
   return {id:d.session_id,cdpUrl:d.cdp_ws_url,configuration:{stealth:true,headless:false,proxy:'stealth ISP default'},release:()=>client.browsers.deleteByID(d.session_id,{maxRetries:0,timeout:30000})};
  }
  if(provider==='steel') {
   const client=new Steel({steelAPIKey:env.STEEL_API_KEY,maxRetries:0,timeout:60000,fetch:request});
   const d=await client.sessions.create({solveCaptcha:true,useProxy:true,timeout:300000});
   const url=d.websocketUrl?new URL(d.websocketUrl):null;url?.searchParams.set('apiKey',env.STEEL_API_KEY!);
   return {id:d.id,cdpUrl:url?.href??'',configuration:{solveCaptcha:true,proxy:true},release:()=>client.sessions.release(d.id,{},{maxRetries:0,timeout:30000})};
  }
  if(provider==='browser-use') {
   const base='https://api.browser-use.com/api/v4/browsers',headers={'X-Browser-Use-API-Key':env.BROWSER_USE_API_KEY!};
   const d=await api(base,'POST',headers,{proxyCountryCode:'us',timeout:5,enableRecording:false});
   return {id:d.id,cdpUrl:d.cdpUrl?.replace('https://','wss://')??'',configuration:{proxy:'US',api:'v4',solver:'provider default'},release:()=>api(`${base}/${encodeURIComponent(d.id)}`,'PATCH',headers,{action:'stop'},30000)};
  }
  const base=env.NOTTE_API_URL||'https://api.notte.cc',headers={Authorization:`Bearer ${env.NOTTE_API_KEY}`};
  const u=new URL(base);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash) throw Error('NOTTE_API_URL must be a credential-free HTTPS origin');
  const body={browser_type:'chrome',headless:true,proxies:[{type:'notte',country:'us'}],solve_captchas:true,max_duration_minutes:5,block_ads:false};
  const d=await api(`${base}/sessions/start`,'POST',headers,body);
  return {id:d.session_id,cdpUrl:d.cdp_url??'',configuration:{...body,api:base},release:()=>api(`${base}/sessions/${encodeURIComponent(d.session_id)}/stop`,'DELETE',headers,undefined,30000)};
 };
}
