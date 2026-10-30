import { mkdir, writeFile } from 'node:fs/promises';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, CDPSession } from 'playwright-core';
export async function bounded<T>(promise:Promise<T>,ms:number):Promise<T> {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(`Operation exceeded ${ms}ms`)),ms);})]);} finally {clearTimeout(timer);}
}
export async function startScreencast(page:Page,dir:string) {
 await mkdir(dir);const cdp=await bounded(page.context().newCDPSession(page),10000);
 const startedAt=Date.now();let frames=0,firstAt:number|null=null,lastAt:number|null=null,error:string|null=null;
 const onFrame=(event:{data:string;sessionId:number;metadata:{timestamp?:number}})=>{
  try {
   if(frames>=10000) throw Error('Recording frame limit exceeded');
   const at=Date.now(),file=`frame-${String(frames).padStart(6,'0')}.jpg`;
   writeFileSync(join(dir,file),Buffer.from(event.data,'base64'));
   appendFileSync(join(dir,'frames.jsonl'),JSON.stringify({file,at,sourceTimestamp:event.metadata.timestamp??null})+'\n');
   frames++;firstAt??=at;lastAt=at;
  }catch {error='Failed to persist every screencast frame';}
  void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{error='Screencast acknowledgement failed';});
 };
 cdp.on('Page.screencastFrame',onFrame);
 try {await bounded(cdp.send('Page.startScreencast',{format:'jpeg',quality:80,everyNthFrame:1}),10000);}catch(e){cdp.off('Page.screencastFrame',onFrame);await cdp.detach().catch(()=>{});throw e;}
 return async()=>{
  try {await bounded(cdp.send('Page.stopScreencast'),10000);}catch {error='Failed to stop screencast';}
  cdp.off('Page.screencastFrame',onFrame);await bounded(cdp.detach(),5000).catch(()=>{error='Failed to detach screencast';});
  const result={startedAt,finishedAt:Date.now(),frames,firstAt,lastAt,error:frames?error:'No screencast frames received'};
  await writeFile(join(dir,'recording.json'),JSON.stringify(result,null,2));return result;
 };
}
export type Recording = Awaited<ReturnType<Awaited<ReturnType<typeof startScreencast>>>>;
