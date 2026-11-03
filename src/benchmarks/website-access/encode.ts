import {readFile,writeFile,access,mkdtemp,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import type {Recording} from './recording.js';
const exec=promisify(execFile);
interface EncodedRecording {sha256:string;durationSeconds:number;firstFrameAt:number;finishedAt:number}
export async function encodeRecording(dir:string) {
 const recording=JSON.parse(await readFile(join(dir,'recording.json'),'utf8')) as Recording;
 if(recording.error||!recording.frames)throw Error('Recording is incomplete; keep raw evidence and do not label it a full replay');
 const frames=(await readFile(join(dir,'frames.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s) as {file:string;at:number});
 if(frames.length!==recording.frames)throw Error('Frame count mismatch');
 for(const f of frames){if(!/^frame-\d{6}\.jpg$/.test(f.file))throw Error('Invalid frame path');await access(join(dir,f.file));}
 if(frames.some((f,i)=>!Number.isFinite(f.at)||i>0&&f.at<frames[i-1].at)||recording.finishedAt<frames.at(-1)!.at)throw Error('Invalid frame timing');
 let completed:EncodedRecording|undefined;
 try {completed=JSON.parse(await readFile(join(dir,'encoded.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(completed) {
  const actual=createHash('sha256').update(await readFile(join(dir,'recording.mp4'))).digest('hex');
  if(actual!==completed.sha256)throw Error('Encoded recording checksum mismatch');
  if(!Number.isFinite(completed.durationSeconds)||completed.durationSeconds<=0||completed.firstFrameAt!==frames[0].at||completed.finishedAt!==recording.finishedAt)throw Error('Encoded recording metadata mismatch');
  return completed;
 }
 const lines=frames.map((f,i)=>`file '${f.file}'\nduration ${Math.max(0.001,((frames[i+1]?.at??recording.finishedAt)-f.at)/1000)}`);
 lines.push(`file '${frames.at(-1)!.file}'`);await writeFile(join(dir,'frames.ffconcat'),lines.join('\n')+'\n');
 // Only publish a decoded video. An interrupted encode must not occupy the final path.
 const temporary=await mkdtemp(join(resolve(dir),'.encoding-')),video=join(temporary,'recording.mp4');
 try {
  await exec('ffmpeg',['-nostdin','-v','error','-n','-f','concat','-safe','1','-i','frames.ffconcat','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-fps_mode','vfr','-movflags','+faststart',video],{cwd:resolve(dir),timeout:120000});
  const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','json',video],{cwd:resolve(dir),timeout:10000});
  const durationSeconds=Number(JSON.parse(stdout).format.duration);
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0)throw Error('Invalid encoded duration');
  await exec('ffmpeg',['-nostdin','-v','error','-i',video,'-f','null','-'],{cwd:resolve(dir),timeout:120000});
  const result:EncodedRecording={sha256:createHash('sha256').update(await readFile(video)).digest('hex'),durationSeconds,firstFrameAt:frames[0].at,finishedAt:recording.finishedAt};
  await writeFile(join(temporary,'encoded.json'),JSON.stringify(result,null,2));
  await rename(video,join(dir,'recording.mp4'));
  await rename(join(temporary,'encoded.json'),join(dir,'encoded.json'));
  return result;
 } finally {await rm(temporary,{recursive:true,force:true});}
}
