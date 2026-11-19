// Runs the actual release bundle in isolated workspaces. Every fetch is intercepted.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';

const release=path.dirname(fileURLToPath(import.meta.url));
const read=async name=>JSON.parse(gunzipSync(await fs.readFile(path.join(release,name))).toString('utf8'));
const seed=await read('seed.json.gz'),state=await read('state.json.gz');
const before=state['public/discovery.json'];
const fixtureMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).slice(0,7);
assert.ok(before?.monthly&&before?.top100?.entries.length===100,'Last verified snapshot required');
const manifest=JSON.parse(await fs.readFile(path.join(release,'cloud-build.json'),'utf8'));
for(const output of manifest.outputs){
 const hash=crypto.createHash('sha256').update(await fs.readFile(path.join(release,output.file))).digest('hex');
 assert.equal(hash,output.sha256,`Build mismatch: ${output.file}`);
}
assert.equal(Object.hasOwn(seed,'data/title-meanings.ko.json'),false,'Retired dictionary must not ship in seed');
assert.ok(seed['data/catalog.json'].songs.every(song=>!song.titleMeaningKo),'Seed must use approved title policy');

const preload=String.raw`
import fs from 'node:fs';
const rows=JSON.parse(fs.readFileSync('fixture.json','utf8'));const calls=[];
const originalTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms<=5000?0:ms,...args);
process.on('exit',()=>fs.writeFileSync('fixture-calls.json',JSON.stringify(calls)));
globalThis.fetch=async(input,options={})=>{
 const u=new URL(String(input));calls.push({path:u.pathname,method:options.method??'GET'});
 if(u.origin==='https://tracert7.github.io'&&u.pathname==='/utanumber-data/discovery.json')return new Response(fs.readFileSync('public/discovery.json','utf8'),{headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
 if(u.origin!=='https://www.tjmedia.com')throw Error('Unexpected fixture origin');
 if(rows.mode==='blocked')return new Response('',{status:403});
 if(u.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /\n');
 if(u.pathname==='/chart/top100')return new Response('<html></html>',{headers:{'set-cookie':'CSRF_TOKEN=offline-fixture; Path=/; Secure'}});
 const body=new URLSearchParams(String(options.body??''));
 let items;
 if(u.pathname==='/legacy/api/topAndHot100'){
  if(body.get('strType')!=='3'||body.get('chartType')!=='TOP')throw Error('Wrong JPOP chart conditions');items=rows.chart;
 }else if(u.pathname==='/legacy/api/newSongOfMonth')items=rows.monthly;
 else throw Error('Unexpected fixture request '+u.pathname);
 return new Response(JSON.stringify({resultCode:'99',resultData:{itemsTotalCount:items.length,items}}),{headers:{'content-type':'application/json'}});
};
`;
const notes=[];
for(const mode of ['normal','monthly-failure','blocked']){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'utanumber-cloud-fixture-'));
 try{
  const input=structuredClone(seed),saved=structuredClone(state);
  saved['data/discovery/request-state.json']={lastAt:0,blocked:false};
  const chart=before.top100.entries.map(e=>({pro:e.song.registrations.tj.number,indexTitle:e.song.titleOriginal,indexSong:e.song.artistOriginal,rank:e.rank}));
  const monthly=before.monthly.entries.map(e=>({pro:e.song.registrations.tj.number,indexTitle:e.song.titleOriginal,indexSong:e.song.artistOriginal,publishdate:fixtureMonth+'-'+e.addedOn.slice(-2)}));
  const numbers=new Set(monthly.map(row=>row.pro));
  const extra=chart.find(row=>!numbers.has(row.pro));
  assert.ok(extra);monthly.push({...extra,publishdate:fixtureMonth+'-01'});
  // The old cloud code would inject this incompatible object. It must be ignored.
  const normalize=s=>s.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{Z}\s\p{P}]/gu,'');
  input['data/title-meanings.ko.json']=Object.fromEntries([...chart,...monthly].map(row=>[normalize(row.indexTitle.replace(/\([^)]*\)|（[^）]*）/g,'')),{source:row.indexTitle,text:'retired fixture meaning',kind:'editorial-literal',reviewer:'offline-fixture'}]));
  const fixture={mode,chart,monthly:mode==='monthly-failure'?[{...monthly[0],publishdate:'invalid'}]:monthly};
  await fs.writeFile(path.join(root,'seed.json.gz'),gzipSync(Buffer.from(JSON.stringify(input))));
  await fs.writeFile(path.join(root,'state.json.gz'),gzipSync(Buffer.from(JSON.stringify(saved))));
  await fs.writeFile(path.join(root,'fixture.json'),JSON.stringify(fixture));
  await fs.writeFile(path.join(root,'preload.mjs'),preload);
  const run=name=>spawnSync(process.execPath,['--import',pathToFileURL(path.join(root,'preload.mjs')).href,path.join(release,name)],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,env:{...process.env,GITHUB_STEP_SUMMARY:''}});
  const refreshed=run('refresh.mjs');
  assert.ifError(refreshed.error);
  await fs.access(path.join(root,'public/discovery.json')).catch(()=>assert.fail(`Bundle did not restore state: ${refreshed.stdout}${refreshed.stderr}`));
  const feed=JSON.parse(await fs.readFile(path.join(root,'public/discovery.json'),'utf8'));
  const calls=JSON.parse(await fs.readFile(path.join(root,'fixture-calls.json'),'utf8'));
  assert.equal(feed.top100.entries.length,100);
  if(mode==='normal'){
   assert.equal(refreshed.status,0,refreshed.stdout+refreshed.stderr);
   assert.equal(feed.errors.length,0);assert.equal(feed.monthly.entries.length,monthly.length);
   assert.ok(Date.parse(feed.monthly.checkedAt)>Date.parse(before.monthly.checkedAt));
   assert.ok(Date.parse(feed.top100.checkedAt)>=Date.parse(before.top100.checkedAt));
   assert.deepEqual(feed.schedule.hours,[6,10,14,18,22]);
   const songs=[...feed.archive,...feed.monthly.entries.map(e=>e.song),...feed.top100.entries.map(e=>e.song)];
   assert.ok(songs.every(song=>!song.titleMeaningKo));
   assert.ok(!JSON.stringify(feed).includes('retired fixture meaning'));
   for(const entry of [...feed.monthly.entries,...feed.top100.entries]){
    const registration=entry.song.registrations.tj;
    const evidence=JSON.parse(await fs.readFile(path.join(root,'data/evidence',registration.evidenceFile),'utf8'));
    assert.ok(evidence.rows.some(row=>row.number===registration.number&&row.title===registration.sourceTitle&&row.artist===registration.sourceArtist));
   }
   const monitored=run('monitor.mjs');assert.ifError(monitored.error);assert.equal(monitored.status,0,monitored.stdout+monitored.stderr);
   const health=JSON.parse(await fs.readFile(path.join(root,'.health/cloud-health.json'),'utf8'));assert.equal(health.healthy,true);
   notes.push({case:mode,monthly:feed.monthly.entries.length,top100:100,monitorHealthy:health.healthy});
  }else{
   assert.equal(refreshed.status,1,refreshed.stdout+refreshed.stderr);
   assert.deepEqual(feed.monthly,before.monthly,'Failed list must keep verified numbers/dates/timestamp');
   assert.ok(feed.errors.length);
   const monitored=run('monitor.mjs');assert.equal(monitored.status,1,'Failure must still alert');
   if(mode==='blocked'){
    assert.equal(calls.length,1,'403 must never retry');
    const persisted=JSON.parse(gunzipSync(await fs.readFile(path.join(root,'state.json.gz'))).toString('utf8'));
    assert.equal(persisted['data/discovery/request-state.json'].blocked.status,403);
    assert.equal(persisted['data/discovery/request-state.json'].blocked.path,'/robots.txt');
    const second=run('refresh.mjs');assert.equal(second.status,1);
    const later=JSON.parse(await fs.readFile(path.join(root,'fixture-calls.json'),'utf8'));assert.equal(later.length,0,'A recorded block must stop before any request');
   }
   notes.push({case:mode,lastGoodMonthlyPreserved:true,monitorRejected:true,requests:calls.length});
  }
 }finally{
  const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.join(os.tmpdir(),'utanumber-cloud-fixture-')));
  await fs.rm(resolved,{recursive:true,force:true});
 }
}
console.log(JSON.stringify({cloudSelfTest:true,externalRequests:0,checks:notes}));
