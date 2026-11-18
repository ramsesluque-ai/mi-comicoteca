'use strict';
// Isolated baseline codec regression; no network, browser data or owner writes.
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const checkpoint=require('../sync-v2-checkpoint.js');
const uid='11111111-1111-4111-8111-111111111111';
const good=[{id:'comic-1',title:'Un cómic',meta:{a:1,b:[1,2]}}];
(async()=>{
 const digest=await checkpoint.digestRows(good,{cryptoImpl:webcrypto});
 const saved=await checkpoint.create({uid,rows:good,remoteSnapshotHash:digest,cryptoImpl:webcrypto});
 assert.equal((await checkpoint.verify({checkpoint:saved,uid,cryptoImpl:webcrypto})).rows.length,1);
 const cyclic={id:'comic-2'};cyclic.self=cyclic;
 const sparse=[1,,3];
 const invalid=[
   {id:'comic-2',extra:undefined},
   {id:'comic-2',extra:()=>1},
   {id:'comic-2',extra:Symbol('x')},
   {id:'comic-2',extra:1n},
   {id:'comic-2',extra:NaN},
   {id:'comic-2',extra:Infinity},
   {id:'comic-2',extra:sparse},
   {id:'comic-2',extra:new Map([['x',1]])},
   {id:'comic-2',extra:new Uint8Array([1,2])},
   {id:'comic-2',extra:new Blob(['binary'],{type:'image/webp'})},
   cyclic
 ];
 for(const row of invalid){
   await assert.rejects(checkpoint.digestRows([row],{cryptoImpl:webcrypto}),/serializable|finito|incompleto|circular|binaria/i);
 }
 // A malicious payload must not be silently normalized during checkpoint verification.
 const tampered={payload:{...saved.payload,rows:[{id:'comic-1',extra:undefined}]},sha256:saved.sha256};
 await assert.rejects(checkpoint.verify({checkpoint:tampered,uid,cryptoImpl:webcrypto}),/serializable/);
 // Canonical property order must remain deterministic.
 assert.equal(await checkpoint.digestRows([{id:'a',x:1,y:2}],{cryptoImpl:webcrypto}),await checkpoint.digestRows([{y:2,x:1,id:'a'}],{cryptoImpl:webcrypto}));
 console.log('PASS checkpoint rejects non-JSON/cyclic binary data, verifies SHA-256 and stable ordering; no real owner writes');
})().catch(e=>{console.error(e);process.exitCode=1});
