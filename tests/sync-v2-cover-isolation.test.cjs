'use strict';
// Isolated transport security tests. Never uses real Supabase credentials or user data.
const assert=require('node:assert/strict');
const integrity=require('../sync-v2-cover-integrity.js');
const transport=require('../sync-v2-cover-transport.js');
const uidA='12345678-1234-1234-1234-123456789abc';
const uidB='87654321-4321-4321-4321-cba987654321';
const cfg={url:'https://test.invalid',publishableKey:'test-public'};
const session=uid=>({user:{id:uid},access_token:'token-'+uid});
const cover=text=>new Blob([text],{type:'image/webp'});
(async()=>{
  const store=new Map(),calls=[];
  const fake=async(url,opts)=>{
    calls.push({url,method:opts.method});
    const uid=opts.headers.Authorization.replace('Bearer token-','');
    const pathname=new URL(url).pathname;
    assert(pathname.startsWith('/storage/v1/object/user-covers/'+uid+'/'),'cross-user object access');
    if(opts.method==='GET'){
      const found=store.get(pathname);
      return found?{ok:true,status:200,blob:async()=>found}:{ok:false,status:404};
    }
    assert.equal(opts.method,'POST');
    assert.equal(opts.headers['x-upsert'],'false');
    if(store.has(pathname))return {ok:false,status:409};
    store.set(pathname,opts.body);
    return {ok:true,status:200};
  };
  const a={session:session(uidA),cfg,key:'same-cover-key',blob:cover('A'),fetchImpl:fake,integrity};
  const b={...a,session:session(uidB),blob:cover('B')};
  assert.equal((await transport.copyIfAbsent(a)).status,'uploaded-and-verified');
  assert.equal((await transport.copyIfAbsent(b)).status,'uploaded-and-verified');
  assert.equal(store.size,2,'user namespaces must not overlap');
  const digestA=await integrity.sha256(a.blob);
  assert.equal((await transport.readVerified({...a,expectedSha256:digestA})).status,'verified');
  await assert.rejects(()=>transport.readVerified({...b,expectedSha256:digestA}),/no coincide/);
  const before=calls.length;
  for(const key of ['../other','x/y','..','.','', '%2f','a?b']){
    await assert.rejects(()=>transport.copyIfAbsent({...a,key}),/inválido/);
  }
  assert.equal(calls.length,before,'invalid keys must not reach network');
  const denied=async()=>({ok:false,status:403});
  await assert.rejects(()=>transport.read({...a,fetchImpl:denied}),/403/);
  const corrupt=async(url,opts)=>{
    if(opts.method==='GET')return calls.length?{ok:true,status:200,blob:async()=>cover('CORRUPT')}:{ok:false,status:404};
    return {ok:true,status:200};
  };
  await assert.rejects(()=>transport.readVerified({...a,expectedSha256:digestA,fetchImpl:corrupt}),/no coincide/);
  console.log('Cover transport isolation: 2 users, invalid keys, access denial, tampering verified');
})().catch(e=>{console.error(e);process.exitCode=1});
