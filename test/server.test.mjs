import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('public APIs, anonymous visitor deduplication, origin checks and restart persistence', async () => {
  const dir=await mkdtemp(join(tmpdir(),'skill-atlas-test-'));
  const port=33210+Math.floor(Math.random()*1000), base=`http://127.0.0.1:${port}`;
  await writeFile(join(dir,'catalog.json'),JSON.stringify({updatedAt:new Date().toISOString(),items:[],sources:[]}));
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),DISABLE_JOBS:'1',PERSIST_INTERVAL_MS:'100'},stdio:['ignore','pipe','pipe']});
  try {
    await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('startup timeout')),5000).unref())]);
    assert.equal((await fetch(base)).status,200);
    const health=await (await fetch(base+'/api/health')).json();assert.equal(health.ok,true);
    assert.equal((await fetch(base+'/.env')).status,404);
    assert.equal((await fetch(base+'/api/presence',{method:'POST',body:'oops'})).status,400);
    assert.equal((await fetch(base+'/api/presence',{method:'POST',headers:{Origin:'https://untrusted.example'},body:JSON.stringify({id:'visitor-1234567890'})})).status,403);
    const beat=async(id)=> (await fetch(base+'/api/presence',{method:'POST',body:JSON.stringify({id})})).json();
    const first=await beat('visitor-1234567890');assert.equal(first.online,1);assert.equal(first.today,1);
    const second=await beat('visitor-1234567890');assert.equal(second.online,1);assert.equal(second.today,1);
    const third=await beat('visitor-abcdefghijkl');assert.equal(third.online,2);assert.equal(third.today,2);
    await new Promise(resolve=>setTimeout(resolve,250));
    const exit=once(child,'exit');child.kill('SIGTERM');await exit;
    const stored=JSON.parse(await readFile(join(dir,'visits.json'),'utf8'));assert.equal(stored.total,2);assert.equal(JSON.stringify(stored).includes('visitor-'),false);
    const restarted=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),DISABLE_JOBS:'1'},stdio:['ignore','pipe','pipe']});
    try {
      await once(restarted.stdout,'data');
      const after=await (await fetch(base+'/api/presence')).json();assert.equal(after.today,2);assert.equal(after.online,0);
      const repeated=await beat('visitor-1234567890');assert.equal(repeated.today,2);assert.equal(repeated.online,1);
    } finally {const ended=once(restarted,'exit');restarted.kill();await ended;}
  } finally {if(child.exitCode===null)child.kill();await rm(dir,{recursive:true,force:true});}
});
