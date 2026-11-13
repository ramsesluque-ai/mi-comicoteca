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
 // Downloads must be verified against the manifest hash before any CoverVault write.
 const digest=await integrity.sha256(args.blob);
 const verified=await transport.readVerified({...args,expectedSha256:digest});
 assert.equal(verified.status,'verified');
 assert.equal(await verified.blob.text(),'cover-A');
 await assert.rejects(()=>transport.readVerified({...args,expectedSha256:'0'.repeat(64)}),/no coincide/);
 await assert.rejects(()=>transport.readVerified({...args,expectedSha256:'invalid'}),/obligatorio/);
 assert.equal((await transport.readVerified({...other,expectedSha256:digest})).status,'missing');
 console.log('Private cover transport: 11 isolated safety scenarios passed');
})().catch(e=>{console.error(e);process.exitCode=1});
