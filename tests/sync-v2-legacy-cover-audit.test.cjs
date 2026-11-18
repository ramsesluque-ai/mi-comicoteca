'use strict';
const assert=require('node:assert/strict');
const audit=require('../sync-v2-legacy-cover-audit.js');
const integrity=require('../sync-v2-cover-integrity.js');
(async()=>{
 const key='cover-1',blob=new Blob(['private fixture'],{type:'image/webp'});
 const entries=new Map([['https://mi-comicoteca.local/cover/'+key,new Response(blob)]]);
 const calls=[];
 const cacheStorage={open:async name=>{calls.push(['open',name]);return {
   match:async url=>{calls.push(['match',url]);return entries.get(url)?.clone()},
   put:async()=>{throw Error('MUST NOT WRITE')},delete:async()=>{throw Error('MUST NOT DELETE')}
 }}};
 const result=await audit.inspect({cacheStorage,keys:[key,'missing'],integrity});
 assert.equal(result.found.length,1);
 assert.equal(result.found[0].sha256,await integrity.sha256(blob));
 assert.deepEqual(result.missing,['missing']);
 assert.equal(result.ownershipVerified,false);
 assert.equal(result.safeToTransfer,false);
 assert.equal(result.readOnly,true);
 assert(calls.every(c=>c[0]==='open'||c[0]==='match'));
 await assert.rejects(audit.inspect({cacheStorage,keys:['../escape'],integrity}),/inválido/);
 await assert.rejects(audit.inspect({cacheStorage,keys:[key,key],integrity}),/inválido/);
 await assert.rejects(audit.inspect({cacheStorage,keys:[key],integrity:null}),/no disponible/);
 console.log('PASS legacy CoverVault audit: SHA-256, missing keys, invalid keys, no writes, ownership unknown');
})().catch(e=>{console.error(e);process.exitCode=1});
