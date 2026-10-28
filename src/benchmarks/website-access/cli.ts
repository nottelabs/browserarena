import 'dotenv/config';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseConfig,planCampaign,missingCredentials} from './config.js';
import {runCampaign,cleaner} from './run.js';
import {encodeRecording} from './encode.js';
import {exportReviewed} from './export.js';
async function main() {
 const [command,...args]=process.argv.slice(2);
 if(command==='plan'||command==='run') {
  const [configPath,out,live]=args;if(!configPath)throw Error('Provide a config path');
  const config=parseConfig(JSON.parse(await readFile(configPath,'utf8')));
  if(command==='plan'){console.log(JSON.stringify({config,visits:planCampaign(config),missingCredentials:missingCredentials(config)},null,2));return;}
  if(!out||live!=='--live')throw Error('Live run requires an unused output directory and --live');
  const missing=missingCredentials(config);if(missing.length)throw Error(`Missing credentials: ${missing.join(', ')}`);
  // Keep raw evidence private until the reviewed, allowlisted export step.
  process.umask(0o077);
  const controller=new AbortController();const abort=()=>controller.abort(Error('Interrupted'));
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'] as const)process.once(signal,abort);
  const sources:Record<string,string>={};for(const f of ['config','providers','recording','run','cli'])sources[f]=createHash('sha256').update(await readFile(new URL(`./${f}.js`,import.meta.url))).digest('hex');
  const metadata={node:process.version,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources,notteOrigin:process.env.NOTTE_API_URL||'https://api.notte.cc'};
  const result=await runCampaign(config,out,{signal:controller.signal,metadata});
  console.log(JSON.stringify({complete:result.complete,attempted:result.rows.length,halted:result.halted}));
  if(!result.complete||result.halted||result.rows.some(r=>r.status!=='captured'||r.recordingError||r.recording?.error))process.exitCode=1;
 }else if(command==='encode') {
  const [runDir]=args;if(!runDir)throw Error('Provide a run directory');
  for(const name of await readdir(join(runDir,'recordings'))){console.log(name);await encodeRecording(join(runDir,'recordings',name));}
 }else if(command==='export') {
  const [runDir,out,date]=args;if(!runDir||!out||!date)throw Error('Provide run directory, unused export directory and YYYY-MM-DD');
  const report=await exportReviewed(runDir,out,date);console.log(`Exported ${report.visits.length} reviewed visits`);
 }else console.log('Website access:\n  plan CONFIG\n  run CONFIG UNUSED_OUTPUT --live\n  encode RUN_DIRECTORY\n  export RUN_DIRECTORY UNUSED_OUTPUT YYYY-MM-DD');
}
main().catch(e=>{console.error(cleaner()(e));process.exitCode=1;});
