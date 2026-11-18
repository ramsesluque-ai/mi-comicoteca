'use strict';
/* Concurrent create-only private cover installation. Fake auth/cache only.
 * No real owner catalogue, JWT, Storage, or browser data accessed.
 */
const assert=require('node:assert/strict');
const bridge=require('../sync-v2-cover-cache-bridge.js');
const integrity=require('../sync-v2-cover-integrity.js');
const uid='11111111-1111-4111-8111-111111111111';
const session={user:{id:uid},access_token:'fake-token'};
const cfg={url:'https://fake-auth.test',publishableKey:'fake-public'};
const fetchImpl=async(url)=> {
 assert.equal(url,'https://fake-auth.test/auth/v1/user');
 return {ok:true,status:200,json:async()=>({id:uid})};
};
function fakeCache(){
 const objects=new Map();let writes=0;
 return {objects,get writes(){return writes},open:async name=>({
  match:async key=>{await new Promise(r=>setTimeout(r,5));return objects.get(name+'|'+key)?.clone()},
  put:async(key,response)=>{await new Promise(r=>setTimeout(r,10));writes++;objects.set(name+'|'+key,response.clone())}
 })};
}
const transport={verifiedCopyIfAbsent(){throw Error('Unexpected network upload')},verifiedReadVerified(){throw Error('Unexpected network download')}};
(async()=>{
 const cacheStorage=fakeCache();
 const first=new Blob(['first binary'],{type:'image/webp'});
 const second=new Blob(['different binary'],{type:'image/webp'});
 const firstHash=await integrity.sha256(first),secondHash=await integrity.sha256(second);
 const opts={session,cfg,key:'same-cover',cacheStorage,integrity,transport,fetchImpl};
 const [a,b]=await Promise.allSettled([
   bridge.installIfAbsent({...opts,blob:first,expectedSha256:firstHash}),
   bridge.installIfAbsent({...opts,blob:second,expectedSha256:secondHash})
 ]);
 assert.equal(a.status,'fulfilled');
 assert.equal(b.status,'rejected');
 assert.match(String(b.reason),/Conflicto de portada local/);
 assert.equal(cacheStorage.writes,1,'No concurrent overwrite allowed');
 const saved=await bridge.local(opts);
 assert.equal(await integrity.sha256(saved),firstHash);
 const repeats=await Promise.all(Array.from({length:8},()=>bridge.installIfAbsent({...opts,blob:first,expectedSha256:firstHash})));
 assert(repeats.every(x=>x.status==='already-identical'));
 assert.equal(cacheStorage.writes,1,'Identical concurrent installs must be idempotent');
 console.log('PASS private cover concurrent create-only lock, divergent conflict, no overwrite, idempotency');
})().catch(e=>{console.error(e);process.exitCode=1});
