import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {parseAccessReport,type AccessVisit} from './schema.js';
import {parseConfig,planCampaign} from './config.js';
import type {Attempt} from './run.js';
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const names:Record<string,string>={'browser-use':'Browser Use',browserbase:'Browserbase',notte:'Notte',kernel:'Kernel',steel:'Steel'};
export async function exportReviewed(runDir:string,out:string,date:string) {
 const config=parseConfig(JSON.parse(await readFile(join(runDir,'configuration.json'),'utf8'))),plan=planCampaign(config);
 const attempts=(await readFile(join(runDir,'attempts.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s) as Attempt);
 const reviews=JSON.parse(await readFile(join(runDir,'review.json'),'utf8')) as {id:string;outcome:AccessVisit['outcome'];reason:string;reviewed:boolean}[];
 if(!Array.isArray(reviews)||reviews.length!==plan.length||new Set(reviews.map(r=>r.id)).size!==plan.length||attempts.length!==plan.length||new Set(attempts.map(a=>a.id)).size!==plan.length)throw Error('Every planned slot needs one attempt and one review; incomplete campaigns cannot publish');
 const assets:{source:string;file:string}[]=[];
 const visits:AccessVisit[]=[];
 for(const task of plan) {
  const a=attempts.find(a=>a.id===task.id),review=reviews.find(r=>r.id===task.id);if(!a||!review)throw Error('Missing attempt or review');
  let screenshot:AccessVisit['screenshot']=null,replay:AccessVisit['replay']=null;
  const final=a.captures.at(-1);
  if(final?.screenshot) {
   const file=`${task.id}-${config.observation_ms}ms.jpg`;if(final.screenshot!==file)throw Error('Unexpected screenshot path');
   const source=join(runDir,'screenshots',file);screenshot={file,sha256:hash(await readFile(source))};assets.push({source,file});
  }
  let recording: {sha256:string;durationSeconds:number}|null=null;
  try {recording=JSON.parse(await readFile(join(runDir,'recordings',task.id,'encoded.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(recording) {
   const source=join(runDir,'recordings',task.id,'recording.mp4'),actual=hash(await readFile(source));
   if(actual!==recording.sha256)throw Error('Encoded recording checksum mismatch');
   replay={file:`${task.id}.mp4`,kind:'original',sha256:actual,durationSeconds:recording.durationSeconds};assets.push({source,file:replay.file});
  }
  visits.push({id:task.id,site:task.target.id,provider:task.provider,round:task.round,outcome:review.outcome,reason:review.reason,reviewed:review.reviewed,screenshot,replay});
 }
 const report=parseAccessReport({schemaVersion:1,id:`website-access-${date}`,date,title:'Website access',rounds:config.rounds,observationMs:config.observation_ms,providers:config.providers.map(id=>({id,name:names[id]})),sites:config.targets.map(({id,domain,url,source})=>({id,domain,url,source})),visits});
 await mkdir(dirname(out),{recursive:true});await mkdir(out);await mkdir(join(out,'screenshots'));await mkdir(join(out,'videos'));
 for(const asset of assets) await copyFile(asset.source,join(out,asset.file.endsWith('.mp4')?'videos':'screenshots',asset.file));
 await writeFile(join(out,'run.json'),JSON.stringify(report,null,2));return report;
}
