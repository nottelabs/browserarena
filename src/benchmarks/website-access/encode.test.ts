import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);

test('encode CLI resumes after a partial failure without replacing completed evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'access-encode-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bin=join(root,'bin'),recordings=join(root,'recordings');await mkdir(bin);await mkdir(recordings);
 // Exercise the actual CLI/filesystem protocol with a controlled codec failure.
 const codec=`#!${process.execPath}
const fs=require('node:fs');
const path=require('node:path');
const args=process.argv.slice(2);
if(path.basename(process.argv[1])==='ffprobe'){console.log(JSON.stringify({format:{duration:'1'}}));}
else if(args.includes('concat')){
 fs.appendFileSync('codec-calls','encode\\n');
 const out=args.at(-1);if(args.includes('-n')&&fs.existsSync(out))process.exit(2);
 fs.writeFileSync(out,'encoded-video');
 if(fs.existsSync('fail-encode'))process.exit(1);
}else if(fs.existsSync('fail-decode'))process.exit(1);
`;
 for(const name of ['ffmpeg','ffprobe'])await writeFile(join(bin,name),codec,{mode:0o700});
 const first=join(recordings,'a'),second=join(recordings,'b');
 for(const dir of [first,second]){
  await mkdir(dir);await writeFile(join(dir,'recording.json'),JSON.stringify({frames:1,error:null,finishedAt:2000}));
  await writeFile(join(dir,'frames.jsonl'),JSON.stringify({file:'frame-000000.jpg',at:1000})+'\n');
  await writeFile(join(dir,'frame-000000.jpg'),'original-frame');
 }
 const run=()=>exec(process.execPath,['--import','tsx','src/benchmarks/website-access/cli.ts','encode',root],{env:{...process.env,PATH:bin+':'+process.env.PATH}});
 await writeFile(join(second,'fail-encode'),'');await assert.rejects(run());
 const manifest=await readFile(join(first,'encoded.json'),'utf8'),before=await stat(join(first,'recording.mp4'));
 await assert.rejects(stat(join(second,'recording.mp4')), {code:'ENOENT'});
 assert.equal((await readdir(second)).some(f=>f.startsWith('.encoding-')),false);
 await rm(join(second,'fail-encode'));
 // A partial output from an older encoder is replaceable only after a successful decode.
 await writeFile(join(second,'recording.mp4'),'legacy-partial');await writeFile(join(second,'fail-decode'),'');
 await assert.rejects(run());assert.equal(await readFile(join(second,'recording.mp4'),'utf8'),'legacy-partial');
 await assert.rejects(stat(join(second,'encoded.json')), {code:'ENOENT'});
 await rm(join(second,'fail-decode'));await run();
 assert.equal(await readFile(join(first,'encoded.json'),'utf8'),manifest);
 assert.equal((await stat(join(first,'recording.mp4'))).mtimeMs,before.mtimeMs);
 assert.equal(await readFile(join(first,'codec-calls'),'utf8'),'encode\n');
 assert.equal(await readFile(join(second,'recording.mp4'),'utf8'),'encoded-video');
 assert.equal(await readFile(join(second,'frame-000000.jpg'),'utf8'),'original-frame');
 await run();assert.equal(await readFile(join(second,'codec-calls'),'utf8'),'encode\nencode\nencode\n');
 await writeFile(join(first,'recording.mp4'),'corrupted');
 await assert.rejects(run(),/checksum mismatch/);
 assert.equal(await readFile(join(first,'recording.mp4'),'utf8'),'corrupted');
});
