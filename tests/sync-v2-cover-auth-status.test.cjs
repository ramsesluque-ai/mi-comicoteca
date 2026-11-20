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
 const verified=await transport.verifySession({session,cfg,fetchImpl:async()=>({ok:true,status:200,json:async()=>({id:session.user.id})})});
 assert.equal(verified,session.user.id);
 console.log('PASS private cover identity endpoint requires complete HTTP 200');
})().catch(error=>{console.error(error);process.exitCode=1});
