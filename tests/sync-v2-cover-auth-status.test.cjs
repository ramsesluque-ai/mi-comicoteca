'use strict';
/* Isolated auth status contract: no real Supabase or owner collection. */
const assert=require('node:assert/strict');
const transport=require('../sync-v2-cover-transport.js');
const session={user:{id:'11111111-1111-4111-8111-111111111111'},access_token:'fake-token'};
const cfg={url:'https://fake-auth.test',publishableKey:'fake-public'};
(async()=>{
 for(const status of [204,206,301,302,401,403,500]){
  let calls=0;
  const fetchImpl=async()=>{calls++;return {ok:status>=200&&status<300,status,json:async()=>({id:session.user.id})}};
  await assert.rejects(transport.verifySession({session,cfg,fetchImpl}),/Identidad de portada no verificada/);
  assert.equal(calls,1,'auth request only');
 }
 // A forged cached user id must not authorize a private Storage GET.
 for(const returned of [{id:'22222222-2222-4222-8222-222222222222'}, {}, null]){
  let calls=[];
  const fetchImpl=async(url)=>{calls.push(url);return {status:200,json:async()=>returned}};
  await assert.rejects(
   transport.verifiedReadVerified({session,cfg,key:'cover.webp',expectedSha256:'a'.repeat(64),fetchImpl}),
   /Identidad de portada no coincide/
  );
  assert.equal(calls.length,1,'no Storage request after identity mismatch');
  assert.match(calls[0],/\/auth\/v1\/user$/);
 }
 // Invalid JSON or an offline auth endpoint must also fail before Storage access.
 for(const failure of [async()=>{throw Error('offline')},async()=>{throw SyntaxError('invalid json')} ]){
  let calls=0;
  await assert.rejects(transport.verifiedReadVerified({
   session,cfg,key:'cover.webp',expectedSha256:'a'.repeat(64),
   fetchImpl:async()=>{calls++;return {status:200,json:failure}}
  }));
  assert.equal(calls,1,'no Storage request after auth failure');
 }
 const verified=await transport.verifySession({session,cfg,fetchImpl:async()=>({ok:true,status:200,json:async()=>({id:session.user.id})})});
 assert.equal(verified,session.user.id);
 console.log('PASS private cover identity endpoint requires complete HTTP 200');
})().catch(error=>{console.error(error);process.exitCode=1});
