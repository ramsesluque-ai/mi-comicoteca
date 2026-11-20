'use strict';
// Fake-only: session revoked between private Storage GET and create-only POST.
// No production token, user data, Storage or browser writes.
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const transport=require('../sync-v2-cover-transport.js');
const integrity=require('../sync-v2-cover-integrity.js');
const uid='11111111-1111-4111-8111-111111111111';
const session={user:{id:uid},access_token:'fake-token'};
const cfg={url:'https://fake-auth.test',publishableKey:'fake-public'};
(async()=>{
 const blob=new Blob(['private cover'],{type:'image/png'});
 let auth=0,gets=0,posts=0;
 const fetchImpl=async(url,options={})=>{
   if(url.endsWith('/auth/v1/user')){
     auth++;
     return {status:auth===1?200:401,json:async()=>({id:uid})};
   }
   if(options.method==='GET'){gets++;return {status:404};}
   if(options.method==='POST'){posts++;throw Error('POST must not occur after revoked session');}
   throw Error('unexpected request');
 };
 await assert.rejects(
   transport.verifiedCopyIfAbsent({session,cfg,key:'private.png',blob,integrity,fetchImpl}),
   /Identidad de portada no verificada/
 );
 assert.equal(auth,2,'revalidate after the remote existence GET');
 assert.equal(gets,1,'read-only remote check may occur');
 assert.equal(posts,0,'revoked session must never issue Storage POST');
 console.log('PASS private cover revocation after GET blocks POST (fake only)');
})().catch(e=>{console.error(e);process.exitCode=1});
