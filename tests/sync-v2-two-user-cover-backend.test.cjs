'use strict';
/* Isolated two-user private cover transport E2E. Never reaches production. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const transport=require('../sync-v2-cover-transport.js');
const sha=async blob=>crypto.createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
const integrity={sha256:sha,verifyPair:async(a,b)=>({equal:(await sha(a))===(await sha(b))}),verifyExpected:async(blob,expected)=>{const actualSha256=await sha(blob);return {equal:actualSha256===expected,actualSha256}}};
const uidA='11111111-1111-4111-8111-111111111111',uidB='22222222-2222-4222-8222-222222222222';
const session=uid=>({user:{id:uid},access_token:'token:'+uid});
const cfg={url:'https://isolated.invalid',publishableKey:'fake'};
const objects=new Map();let failNext=false;
const fakeFetch=async(url,options)=>{
 const uid=options.headers.Authorization.replace('Bearer token:','');
 const path=new URL(url).pathname.split('/').slice(-2);
 const [owner,key]=path.map(decodeURIComponent);
 if(owner!==uid)return {ok:false,status:403};
 const id=owner+'/'+key;
 if(failNext){failNext=false;return {ok:false,status:503}}
 if(options.method==='GET'){
  if(!objects.has(id))return {ok:false,status:404};
  return {ok:true,status:200,blob:async()=>new Blob([objects.get(id).bytes],{type:objects.get(id).type})};
 }
 if(options.method==='POST'){
  if(objects.has(id))return {ok:false,status:409};
  objects.set(id,{bytes:Buffer.from(await options.body.arrayBuffer()),type:options.body.type});
  return {ok:true,status:200};
 }
 throw Error('Unexpected method');
};
const args=(uid,key,blob)=>({session:session(uid),cfg,key,blob,fetchImpl:fakeFetch,integrity});
(async()=>{
 const cover=new Blob([Buffer.from('original image binary')],{type:'image/webp'});
 const changed=new Blob([Buffer.from('different image binary')],{type:'image/webp'});
 const first=await transport.copyIfAbsent(args(uidA,'cover-1',cover));
 assert.equal(first.status,'uploaded-and-verified');
 assert.equal((await transport.copyIfAbsent(args(uidA,'cover-1',cover))).status,'already-identical');
 await assert.rejects(transport.copyIfAbsent(args(uidA,'cover-1',changed)),/Conflicto/);
 assert.equal((await transport.readVerified({...args(uidA,'cover-1'),expectedSha256:await sha(cover)})).status,'verified');
 await assert.rejects(transport.readVerified({...args(uidA,'cover-1'),expectedSha256:await sha(changed)}),/SHA-256/);
 assert.equal((await transport.readVerified({...args(uidB,'cover-1'),expectedSha256:await sha(cover)})).status,'missing');
 await transport.copyIfAbsent(args(uidB,'cover-1',changed));
 assert.equal(objects.size,2);
 assert.equal((await sha(await transport.read(args(uidA,'cover-1')))),await sha(cover));
 failNext=true;
 await assert.rejects(transport.copyIfAbsent(args(uidA,'retry-cover',cover)),/503|recuperar/);
 assert.equal(objects.has(uidA+'/retry-cover'),false);
 assert.equal((await transport.copyIfAbsent(args(uidA,'retry-cover',cover))).status,'uploaded-and-verified');
 // A second user's valid token cannot fetch the first user's namespace by changing the key.
 assert.equal((await transport.readVerified({...args(uidB,'cover-1'),expectedSha256:await sha(changed)})).status,'verified');
 // Corruption after a successful upload must be detected by the mandatory GET + digest.
 const tamperKey='tampered-cover';
 const originalSet=objects.set.bind(objects);
 objects.set=(key,value)=>originalSet(key,key===uidA+'/'+tamperKey?{bytes:Buffer.from('tampered remote bytes'),type:'image/webp'}:value);
 await assert.rejects(transport.copyIfAbsent(args(uidA,tamperKey,cover)),/SHA-256 distinto/);
 objects.set=originalSet;
 // A 409 race is only accepted when the remote object is byte-identical.
 const raceKey='race-conflict';
 const previousFetch=fakeFetch;
 const raceFetch=async(url,options)=>{
   if(options.method==='POST'&&url.endsWith('/'+raceKey)){
     objects.set(uidA+'/'+raceKey,{bytes:Buffer.from('different raced bytes'),type:'image/webp'});
     return {ok:false,status:409};
   }
   return previousFetch(url,options);
 };
 await assert.rejects(transport.copyIfAbsent({...args(uidA,raceKey,cover),fetchImpl:raceFetch}),/SHA-256 distinto/);
 await assert.rejects(transport.readVerified({...args(uidA,'cover-1'),expectedSha256:'invalid'}),/SHA-256 esperado/);
 await assert.rejects(transport.copyIfAbsent({...args(uidA,'cover-1',cover),session:{user:{id:uidA},access_token:''}}),/Sesión/);
 await assert.rejects(transport.copyIfAbsent(args(uidA,'../escape',cover)),/inválido/);
 // Simulate a timeout/503 AFTER the server persisted the object: a retry must
 // verify identical bytes, not overwrite or create a second object.
 const uncertainKey='uncertain-post';
 let uncertainOnce=true;
 const uncertainFetch=async(url,options)=>{
   if(uncertainOnce&&options.method==='POST'&&url.endsWith('/'+uncertainKey)){
     uncertainOnce=false;
     objects.set(uidA+'/'+uncertainKey,{bytes:Buffer.from(await options.body.arrayBuffer()),type:options.body.type});
     return {ok:false,status:503};
   }
   return fakeFetch(url,options);
 };
 assert.equal((await transport.copyIfAbsent({...args(uidA,uncertainKey,cover),fetchImpl:uncertainFetch})).status,'uploaded-response-lost-verified');
 const countBeforeRetry=objects.size;
 assert.equal((await transport.copyIfAbsent({...args(uidA,uncertainKey,cover),fetchImpl:uncertainFetch})).status,'already-identical');
 assert.equal(objects.size,countBeforeRetry);
 await assert.rejects(transport.copyIfAbsent({...args(uidA,uncertainKey,changed),fetchImpl:uncertainFetch}),/Conflicto/);
 // A remote 403 is a hard error, never interpreted as a missing cover.
 const forbiddenFetch=async()=>({ok:false,status:403});
 await assert.rejects(transport.copyIfAbsent({...args(uidA,'forbidden',cover),fetchImpl:forbiddenFetch}),/403/);
 assert.equal(objects.has(uidA+'/forbidden'),false);
 console.log('PASS isolated two-user cover binary transport, GET, SHA-256, conflict, retry and namespace isolation; NOT real RLS/E2E');
})().catch(e=>{console.error(e);process.exitCode=1});
