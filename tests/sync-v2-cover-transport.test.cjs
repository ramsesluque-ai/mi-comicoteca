'use strict';
const assert=require('node:assert/strict');
// Node 22+ exposes globalThis.crypto as a read-only accessor.
const integrity=require('../sync-v2-cover-integrity.js');
const transport=require('../sync-v2-cover-transport.js');
const uid='12345678-1234-1234-1234-123456789abc';
const session={user:{id:uid},access_token:'test-token'};
const cfg={url:'https://test.invalid',publishableKey:'public-test'};
const blob=x=>new Blob([x],{type:'image/webp'});
function fake(){
 const storage=new Map(),calls=[];
 async function fetchImpl(url,opts){
  calls.push({url,method:opts.method,headers:opts.headers});
  assert(url.includes('/user-covers/'+uid+'/'));
  assert.equal(opts.headers.Authorization,'Bearer test-token');
  if(opts.method==='GET'){
   const v=storage.get(url);
   return v?{ok:true,status:200,blob:async()=>v}:{ok:false,status:404};
  }
  assert.equal(opts.method,'POST');
  assert.equal(opts.headers['x-upsert'],'false');
  if(storage.has(url))return {ok:false,status:409};
  storage.set(url,opts.body);return {ok:true,status:200};
 }
 return {storage,calls,fetchImpl};
}
(async()=>{
 const f=fake(),args={session,cfg,key:'comic-1',blob:blob('cover-A'),fetchImpl:f.fetchImpl,integrity};
 assert.equal((await transport.copyIfAbsent(args)).status,'uploaded-and-verified');
 assert.equal((await transport.copyIfAbsent(args)).status,'already-identical');
 assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
 await assert.rejects(()=>transport.copyIfAbsent({...args,blob:blob('cover-B')}),/Conflicto/);
 assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
 await assert.rejects(()=>transport.copyIfAbsent({...args,key:'../other'}),/inválido/);
 await assert.rejects(()=>transport.copyIfAbsent({...args,session:{user:{id:uid}}}),/Sesión/);
 // A 36-character string of hyphens is not a valid UID; fail before any HTTP request.
 await assert.rejects(()=>transport.copyIfAbsent({...args,session:{user:{id:'-'.repeat(36)},access_token:'test-token'}}),/Sesión/);
 await assert.rejects(()=>transport.read({...args,session:{user:{id:'12345678123412341234123456789abc'},access_token:'test-token'}}),/Sesión/);
 // A configured base URL ending in / must not create //storage paths (404 on some gateways).
 const trailing=fake();
 const trailingArgs={...args,cfg:{...cfg,url:cfg.url+'/'},key:'trailing-slash',fetchImpl:async(url,opts)=>{
   assert.equal(url,'https://test.invalid/storage/v1/object/user-covers/'+uid+'/trailing-slash');
   return trailing.fetchImpl(url,opts);
 }};
 assert.equal((await transport.copyIfAbsent(trailingArgs)).status,'uploaded-and-verified');
 assert.equal((await transport.readVerified({...trailingArgs,expectedSha256:await integrity.sha256(args.blob)})).status,'verified');
 const f2=fake(),other={...args,fetchImpl:f2.fetchImpl};
 assert.equal(await transport.read(other),null);
 // Simulate race: another writer creates an identical blob between GET and POST.
 const race=fake();let first=true;
 const fetchRace=async(url,opts)=>{
  if(opts.method==='GET'&&first){first=false;return {ok:false,status:404}}
  if(opts.method==='POST'){race.storage.set(url,opts.body);return {ok:false,status:409}}
  return race.fetchImpl(url,opts);
 };
 assert.equal((await transport.copyIfAbsent({...args,fetchImpl:fetchRace})).status,'concurrent-identical');
 // Ambiguous 503: Storage may have persisted the image before response was lost.
 const persisted=fake();
 const responseLost=async(url,opts)=>{
   const result=await persisted.fetchImpl(url,opts);
   if(opts.method==='POST')return {ok:false,status:503};
   return result;
 };
 assert.equal((await transport.copyIfAbsent({...args,key:'response-lost',fetchImpl:responseLost})).status,'uploaded-response-lost-verified');
 assert.equal(persisted.calls.filter(x=>x.method==='POST').length,1);
 const notPersisted=fake();
 const unavailable=async(url,opts)=>opts.method==='POST'?{ok:false,status:503}:notPersisted.fetchImpl(url,opts);
 await assert.rejects(()=>transport.copyIfAbsent({...args,key:'not-persisted',fetchImpl:unavailable}),/Subida incierta/);
 assert.equal(notPersisted.calls.filter(x=>x.method==='POST').length,0);
 // POST 503 followed by an unavailable verification GET is ambiguous: never retry blindly.
 let ambiguousGets=0,ambiguousPosts=0;
 const unavailableVerification=async(url,opts)=>{
   if(opts.method==='GET'){
     ambiguousGets++;
     if(ambiguousGets===1)return {ok:false,status:404};
     throw Error('verification network outage');
   }
   ambiguousPosts++;
   return {ok:false,status:503};
 };
 await assert.rejects(()=>transport.copyIfAbsent({...args,key:'503-get-offline',fetchImpl:unavailableVerification}),/Subida incierta.*GET de verificación falló/);
 assert.equal(ambiguousPosts,1);
 assert.equal(ambiguousGets,2);
 const corrupted=fake();
 const wrongAfter503=async(url,opts)=>{
   if(opts.method==='POST'){corrupted.storage.set(url,blob('different bytes'));return {ok:false,status:503}}
   return corrupted.fetchImpl(url,opts);
 };
 await assert.rejects(()=>transport.copyIfAbsent({...args,key:'corrupted-503',fetchImpl:wrongAfter503}),/Conflicto tras respuesta incierta/);
 // A thrown network error after POST can still mean Storage persisted the bytes.
 const dropped=fake();
 const droppedFetch=async(url,opts)=>{
   const result=await dropped.fetchImpl(url,opts);
   if(opts.method==='POST')throw Error('connection reset after commit');
   return result;
 };
 assert.equal((await transport.copyIfAbsent({...args,key:'network-dropped',fetchImpl:droppedFetch})).status,'uploaded-network-error-verified');
 assert.equal(dropped.calls.filter(x=>x.method==='POST').length,1);
 const lost=fake();
 const lostFetch=async(url,opts)=>opts.method==='POST'?Promise.reject(Error('offline')):lost.fetchImpl(url,opts);
 await assert.rejects(()=>transport.copyIfAbsent({...args,key:'network-missing',fetchImpl:lostFetch}),/Subida incierta/);
 const unreadable=fake();
 let unreadableGets=0;
 const unreadableFetch=async(url,opts)=>{
   if(opts.method==='GET'&&++unreadableGets===1)return {ok:false,status:404};
   throw Error('network offline');
 };
 await assert.rejects(()=>transport.copyIfAbsent({...args,key:'network-unreadable',fetchImpl:unreadableFetch}),/Subida incierta/);
 const mismatch=fake();
 const mismatchFetch=async(url,opts)=>{
   if(opts.method==='POST'){mismatch.storage.set(url,blob('different bytes'));throw Error('connection reset')}
   return mismatch.fetchImpl(url,opts);
 };
 await assert.rejects(()=>transport.copyIfAbsent({...args,key:'network-mismatch',fetchImpl:mismatchFetch}),/Conflicto tras error de red/);
 // Downloads must be verified against the manifest hash before any CoverVault write.
 const digest=await integrity.sha256(args.blob);
 const verified=await transport.readVerified({...args,expectedSha256:digest});
 assert.equal(verified.status,'verified');
 assert.equal(await verified.blob.text(),'cover-A');
 await assert.rejects(()=>transport.readVerified({...args,expectedSha256:'0'.repeat(64)}),/no coincide/);
 await assert.rejects(()=>transport.readVerified({...args,expectedSha256:'invalid'}),/obligatorio/);
 assert.equal((await transport.readVerified({...other,expectedSha256:digest})).status,'missing');
 // Reject non-images, zero-byte and oversized files before any remote write.
 const before=f.calls.filter(x=>x.method==='POST').length;
 for(const invalid of [new Blob([],{type:'image/png'}),new Blob(['not an image'],{type:'text/html'}),new Blob([new Uint8Array(5*1024*1024+1)],{type:'image/png'})]){
   await assert.rejects(()=>transport.copyIfAbsent({...args,key:'invalid',blob:invalid}),/Portada inválida/);
 }
 assert.equal(f.calls.filter(x=>x.method==='POST').length,before);
 const badRead=async()=>({ok:true,status:200,blob:async()=>new Blob(['HTML'],{type:'text/html'})});
 await assert.rejects(()=>transport.read({...args,key:'bad-remote',fetchImpl:badRead}),/Portada inválida/);
 // A denied authenticated read must never be interpreted as a missing object.
 const denied=async()=>({ok:false,status:403});
 await assert.rejects(()=>transport.read({...args,key:'denied',fetchImpl:denied}),/403/);
 const unauthorized=async()=>({ok:false,status:401});
 await assert.rejects(()=>transport.copyIfAbsent({...args,key:'unauthorized',fetchImpl:unauthorized}),/401/);
 // User namespace must be derived from the authenticated session, never a supplied key.
 const secondUid='abcdefab-1234-1234-1234-abcdefabcdef';
 const secondSession={user:{id:secondUid},access_token:'second-user-token'};
 const isolated=fake();
 const isolatedFetch=async(url,opts)=>{
   assert(url.includes('/user-covers/'+secondUid+'/'));
   assert(!url.includes('/user-covers/'+uid+'/'));
   assert.equal(opts.headers.Authorization,'Bearer second-user-token');
   if(opts.method==='GET')return {ok:false,status:404};
   return {ok:true,status:200};
 };
 assert.equal(await transport.read({...args,session:secondSession,key:'safe-key',fetchImpl:isolatedFetch}),null);
 await assert.rejects(()=>transport.read({...args,key:'other-user/cover',fetchImpl:isolatedFetch}),/inválido/);
 console.log('Private cover transport: 23 isolated safety scenarios passed');
})().catch(e=>{console.error(e);process.exitCode=1});
