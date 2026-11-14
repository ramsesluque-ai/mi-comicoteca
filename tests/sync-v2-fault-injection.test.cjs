'use strict';
// Fault-injection for two independent sessions against a fake, read-only backend.
// Never uses production credentials, IndexedDB, Storage or the owner's collection.
const assert=require('node:assert/strict');
const {compare}=require('../sync-v2-manual-plan.js');
const uid='00000000-0000-4000-8000-000000000011';
const other='00000000-0000-4000-8000-000000000012';
const cfg={url:'https://fake.invalid',publishableKey:'test-only'};
const session=(id)=>({user:{id},access_token:'fake-'+id});
const make=(n)=>({id:'id-'+String(n).padStart(5,'0'),publisher:'Test',series:'Test series',issueNr:String(n),title:'Comic '+n,coverKey:'private-'+n});
const rows=Array.from({length:501},(_,i)=>make(i));
const backend=new Map([[uid,rows.map(record=>({user_id:uid,local_id:'comics:'+record.id,metadata:{kind:'comics',record}}))],[other,[{user_id:other,local_id:'comics:id-00999',metadata:{kind:'comics',record:make(999)}}]]]);
function fake({failAt=0,deny=false,abortAt=0}={}){
 let calls=0,mutations=0;
 const fetcher=async(url,opts)=>{
  assert.equal(opts.method,'GET');
  assert.equal(opts.cache,'no-store');
  if(!url.startsWith(cfg.url+'/'))throw Error('Unexpected endpoint');
  const auth=opts.headers.Authorization.slice(7).replace('fake-','');
  if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:auth})};
  assert(url.includes('/rest/v1/user_comics?'));
  calls++;
  if(deny)return {ok:false,status:403};
  if(failAt===calls)return {ok:false,status:503};
  if(abortAt===calls)opts.signal?.abort?.();
  const query=new URL(url).searchParams;
  assert.equal(query.get('user_id'),'eq.'+auth);
  const last=query.get('local_id')?.slice(3);
  const data=(backend.get(auth)||[]).filter(r=>!last||r.local_id>last)
    .sort((a,b)=>a.local_id<b.local_id?-1:a.local_id>b.local_id?1:0)
    .slice(0,Number(query.get('limit')));
  return {ok:true,json:async()=>data};
 };
 return {fetcher,get calls(){return calls},get mutations(){return mutations}};
}
(async()=>{
 for(const id of [uid,other]){
  const svc=fake();
  const result=await compare({session:session(id),cfg,localRows:id===uid?rows:[],fetcher:svc.fetcher,pageSize:100});
  assert.equal(result.complete,true);
  assert.equal(result.safeToWrite,false);
  assert.equal(result.cloud,id===uid?501:1);
  assert.equal(result.onlyCloud,id===uid?0:1);
  assert.equal(svc.mutations,0);
 }
 const transient=fake({failAt:3});
 await assert.rejects(compare({session:session(uid),cfg,localRows:rows,fetcher:transient.fetcher,pageSize:100}),/503/);
 // A fresh explicit retry starts from the beginning; never resume an incomplete plan.
 const retry=fake();
 const result=await compare({session:session(uid),cfg,localRows:rows,fetcher:retry.fetcher,pageSize:100});
 assert.equal(result.equal,501);
 assert.equal(result.safeToWrite,false);
 const denied=fake({deny:true});
 await assert.rejects(compare({session:session(other),cfg,localRows:[],fetcher:denied.fetcher}),/403/);
 const truncated=fake();
 await assert.rejects(compare({session:session(uid),cfg,localRows:rows,fetcher:truncated.fetcher,pageSize:100,maxPages:2}),/límite de paginación/);
 const ctrl=new AbortController();
 const cancelled=fake();
 await assert.rejects(compare({session:session(uid),cfg,localRows:rows,fetcher:cancelled.fetcher,pageSize:100,signal:ctrl.signal,onProgress:()=>ctrl.abort()}),/cancelada/);
 assert.equal(cancelled.mutations,0);
 console.log('PASS fake two-user keyset, 503 retry, 403, incomplete pagination, cancellation; zero writes');
})().catch(e=>{console.error(e);process.exitCode=1});
