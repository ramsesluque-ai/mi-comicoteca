'use strict';
/* Browser-like private CoverVault ↔ Supabase Storage two-device regression.
 * Entirely in memory. The real user's IndexedDB, Storage and JWTs are NEVER used.
 */
const assert=require('node:assert/strict');
const integrity=require('../sync-v2-cover-integrity.js');
const transport=require('../sync-v2-cover-transport.js');
const bridge=require('../sync-v2-cover-cache-bridge.js');
const uidA='11111111-1111-4111-8111-111111111111';
const uidB='22222222-2222-4222-8222-222222222222';
const session=uid=>({user:{id:uid},access_token:'token:'+uid});
const cfg={url:'https://fake-private.test',publishableKey:'public-test'};
const img=text=>new Blob([text],{type:'image/webp'});
function caches(){
 const namespaces=new Map();const actions=[];
 return {namespaces,actions,open:async name=>{
   if(!namespaces.has(name))namespaces.set(name,new Map());
   const store=namespaces.get(name);
   return {
     match:async key=>store.get(key)?.clone(),
     put:async(key,value)=>{actions.push({method:'put',name,key});store.set(key,value.clone())}
   };
 }};
}
(async()=>{
 const remote=new Map(),requests=[];let deny=false,losePost=false;
 const fetchImpl=async(url,opts)=>{
   const uid=opts.headers.Authorization.replace('Bearer token:','');
   requests.push({url,method:opts.method,uid});
   if(deny)return {ok:false,status:403};
   if(url.endsWith('/auth/v1/user'))
     return {ok:true,status:200,json:async()=>({id:uid})};
   const match=new URL(url).pathname.match(/^\/storage\/v1\/object\/user-covers\/([^/]+)\/([^/]+)$/);
   assert(match,'Must only access private object path');
   const owner=decodeURIComponent(match[1]),key=decodeURIComponent(match[2]);
   if(owner!==uid)return {ok:false,status:403};
   const name=owner+'/'+key;
   if(opts.method==='GET'){
     const value=remote.get(name);
     return value?{ok:true,status:200,blob:async()=>value.slice(0,value.size,value.type)}:{ok:false,status:404};
   }
   assert.equal(opts.method,'POST');
   assert.equal(opts.headers['x-upsert'],'false');
   if(remote.has(name))return {ok:false,status:409};
   remote.set(name,opts.body);
   if(losePost){losePost=false;return {ok:false,status:503}}
   return {ok:true,status:200};
 };
 const device1=caches(),device2=caches(),differentUser=caches();
 const opts=(user,key,cacheStorage,expectedSha256)=>({session:session(user),cfg,key,cacheStorage,expectedSha256,fetchImpl,integrity,transport});
 const original=img('private cover originally attached on device A');
 const digest=await integrity.sha256(original);
 // Original cover is made available in a per-user cache. No migration from the
 // old cross-user CoverVault is assumed or performed by this bridge.
 assert.equal((await bridge.installIfAbsent({...opts(uidA,'cover-01',device1,digest),blob:original})).status,'downloaded-and-verified');
 assert.equal((await bridge.upload(opts(uidA,'cover-01',device1,digest))).status,'uploaded-and-verified');
 assert.equal((await bridge.download(opts(uidA,'cover-01',device2,digest))).status,'downloaded-and-verified');
 assert.equal((await integrity.sha256(await bridge.local(opts(uidA,'cover-01',device2,digest)))),digest);
 assert.equal((await bridge.download(opts(uidA,'cover-01',device2,digest))).status,'already-identical');
 assert.equal((await bridge.upload(opts(uidA,'cover-01',device1,digest))).status,'already-identical');
 assert.equal(remote.size,1);
 assert.equal(device2.actions.length,1,'Idempotent re-download must not write again');
 assert.equal(device1.namespaces.has(bridge.cacheName(uidB)),false);
 // The second user's cache and remote namespace are distinct, even for same key.
 const other=img('different private user cover'),otherDigest=await integrity.sha256(other);
 await bridge.installIfAbsent({...opts(uidB,'cover-01',differentUser,otherDigest),blob:other});
 await bridge.upload(opts(uidB,'cover-01',differentUser,otherDigest));
 assert.equal(remote.size,2);
 assert.notEqual(bridge.cacheName(uidA),bridge.cacheName(uidB));
 // An untracked remote file must not be accepted without a SHA manifest.
 await assert.rejects(bridge.download(opts(uidA,'cover-01',caches(),'bad')),/SHA-256 esperado/);
 await assert.rejects(bridge.upload(opts(uidA,'cover-01',device1,'0'.repeat(64))),/SHA-256 local/);
 // The same key cannot replace existing cache bytes, even when the remote differs.
 await assert.rejects(bridge.installIfAbsent({...opts(uidA,'cover-01',device2,otherDigest),blob:other}),/Conflicto de portada local/);
 assert.equal((await integrity.sha256(await bridge.local(opts(uidA,'cover-01',device2,digest)))),digest);
 // A corrupt remote file must be rejected before any local installation.
 remote.set(uidA+'/corrupt',img('corrupted'));
 const corruptCache=caches(),before=corruptCache.actions.length;
 await assert.rejects(bridge.download(opts(uidA,'corrupt',corruptCache,digest)),/SHA-256/);
 assert.equal(corruptCache.actions.length,before);
 // HTTP 403 must block both directions; it is not 'remote missing'.
 deny=true;
 await assert.rejects(bridge.download(opts(uidA,'cover-01',caches(),digest)),/403/);
 await assert.rejects(bridge.upload(opts(uidA,'cover-01',device1,digest)),/403/);
 deny=false;
 // A response-lost 503 after persist gets verified using GET, no second POST.
 const lost=img('persisted despite 503'),lostDigest=await integrity.sha256(lost);
 await bridge.installIfAbsent({...opts(uidA,'uncertain',device1,lostDigest),blob:lost});
 losePost=true;
 assert.equal((await bridge.upload(opts(uidA,'uncertain',device1,lostDigest))).status,'uploaded-response-lost-verified');
 assert.equal((await bridge.upload(opts(uidA,'uncertain',device1,lostDigest))).status,'already-identical');
 assert.equal(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/uncertain')).length,1);
 // No mixing with Maestro buckets and no catalog mutations.
 assert(requests.filter(r=>r.method!=='GET'&&r.method!=='POST').length===0);
 assert(requests.every(r=>r.url.includes('/auth/v1/user')||r.url.includes('/storage/v1/object/user-covers/')));
 // Verify 28 separate private objects can be transferred without duplicating
 // remote files or leaking into another user's local CacheStorage.
 const bulkSource=caches(),bulkTarget=caches();
 for(let n=0;n<28;n++){
   const key='private-cover-'+n,blob=img('distinct-binary-'+n),hash=await integrity.sha256(blob);
   await bridge.installIfAbsent({...opts(uidA,key,bulkSource,hash),blob});
   await bridge.upload(opts(uidA,key,bulkSource,hash));
   await bridge.download(opts(uidA,key,bulkTarget,hash));
   assert.equal(await integrity.sha256(await bridge.local(opts(uidA,key,bulkTarget,hash))),hash);
 }
 assert.equal(bulkTarget.actions.length,28);
 console.log('PASS staged private CoverVault: two devices, two users, 28 covers, SHA-256, 403, 503, conflicts, idempotency, isolated caches');
 console.log('NOT a production auth/RLS browser E2E and not wired to the manual sync button.');
})().catch(e=>{console.error(e);process.exitCode=1});
