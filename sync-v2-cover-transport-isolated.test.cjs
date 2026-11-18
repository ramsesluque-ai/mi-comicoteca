'use strict';
// Isolated two-session fake Storage tests. No Supabase credentials, no production writes.
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
globalThis.crypto=webcrypto;
const integrity=require('./sync-v2-cover-integrity.js');
const transport=require('./sync-v2-cover-transport.js');
const uidA='11111111-1111-4111-8111-111111111111';
const uidB='22222222-2222-4222-8222-222222222222';
const cfg={url:'https://fake-storage.invalid',publishableKey:'test-public-key'};
const sessions=[uidA,uidB].map(id=>({user:{id},access_token:'token-'+id}));
const store=new Map();
let failures=0;
const blob=text=>new Blob([text],{type:'image/png'});
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body,blob:async()=>body});
async function fakeFetch(url,options={}){
 const auth=options.headers?.Authorization?.replace('Bearer ','');
 const uid=auth?.replace('token-','');
 if(![uidA,uidB].includes(uid))return response(401,{});
 if(url.endsWith('/auth/v1/user'))return response(200,{id:uid});
 const prefix=cfg.url+'/storage/v1/object/user-covers/';
 if(!url.startsWith(prefix))throw Error('Unexpected URL');
 const [owner,key]=url.slice(prefix.length).split('/').map(decodeURIComponent);
 if(owner!==uid)return response(403,{});
 const path=owner+'/'+key;
 if(options.method==='GET')return store.has(path)?response(200,store.get(path)):response(404,{});
 if(options.method==='POST'){
  if(store.has(path))return response(409,{});
  store.set(path,options.body);
  if(failures-- >0)throw Error('simulated lost response');
  return response(200,{});
 }
 throw Error('Unexpected method');
}
(async()=>{
 const a=blob('cover A'),b=blob('cover B');
 const options=(session,key,cover)=>({session,cfg,key,blob:cover,fetchImpl:fakeFetch,integrity});
 assert.equal((await transport.verifiedCopyIfAbsent(options(sessions[0],'front.png',a))).status,'uploaded-and-verified');
 assert.equal((await transport.verifiedCopyIfAbsent(options(sessions[0],'front.png',a))).status,'already-identical');
 await assert.rejects(transport.verifiedCopyIfAbsent(options(sessions[0],'front.png',b)),/Conflicto/);
 const hash=await integrity.sha256(a);
 assert.equal((await transport.verifiedReadVerified({...options(sessions[0],'front.png',a),expectedSha256:hash})).status,'verified');
 await assert.rejects(transport.verifiedReadVerified({...options(sessions[0],'front.png',a),expectedSha256:'0'.repeat(64)}),/SHA-256/);
 assert.equal((await transport.verifiedReadVerified({...options(sessions[1],'front.png',a),expectedSha256:hash})).status,'missing');
 failures=1;
 assert.equal((await transport.verifiedCopyIfAbsent(options(sessions[1],'front.png',b))).status,'uploaded-network-error-verified');
 assert.equal(store.size,2);
 await assert.rejects(transport.verifiedReadVerified({...options(sessions[0],'front.png',a),session:{...sessions[0],access_token:sessions[1].access_token},expectedSha256:hash}),/Identidad/);
 console.log('PASS isolated private cover transport: two users, GET, SHA-256, conflict, retry ambiguity, identity mismatch');
})().catch(error=>{console.error(error);process.exitCode=1});
