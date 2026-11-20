'use strict';
const assert=require('node:assert/strict');
const {compare}=require('../sync-v2-manual-plan.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const cfg={url:'https://isolated.example',publishableKey:'fake-test-only'};
const session=id=>({access_token:'test-'+id,user:{id}});
function row(uid,id,record){return {user_id:uid,local_id:'comics:'+id,metadata:{kind:'comics',record}}}
function fake(uid,rows,{revoke=false,failPage=false}={}){
 let authCalls=0, pageCalls=0;
 return async (url)=>{
   if(url.endsWith('/auth/v1/user')){authCalls++;return {ok:!(revoke&&authCalls>1),status:401,json:async()=>({id:uid})}}
   assert(url.includes('/rest/v1/user_comics?'));
   pageCalls++;
   if(failPage&&pageCalls===2)return {ok:false,status:503};
   const u=new URL(url),limit=Number(u.searchParams.get('limit')),cursor=u.searchParams.get('local_id');
   assert.equal(u.searchParams.get('user_id'),'eq.'+uid);
   const visible=rows.filter(r=>r.user_id===uid&&(!cursor||r.local_id>cursor.slice(3))).sort((a,b)=>a.local_id.localeCompare(b.local_id)).slice(0,limit);
   return {ok:true,json:async()=>visible};
 };
}
(async()=>{
 const shared=[row(A,'a',{id:'a',title:'A'}),row(A,'b',{id:'b',title:'B remote'}),row(A,'d',{id:'d',title:'D'}),row(B,'secret',{id:'secret',title:'Private B'})];
 const local=[{id:'a',title:'A'},{id:'b',title:'B local'},{id:'c',title:'C'}];
 const a=await compare({session:session(A),cfg,localRows:local,fetcher:fake(A,shared),pageSize:2});
 assert.deepEqual([a.equal,a.different,a.onlyLocal,a.onlyCloud,a.cloud,a.safeToWrite],[1,1,1,1,3,false]);
 const b=await compare({session:session(B),cfg,localRows:[],fetcher:fake(B,shared),pageSize:2});
 assert.deepEqual([b.cloud,b.onlyCloud,b.safeToWrite],[1,1,false]);
 await assert.rejects(compare({session:session(A),cfg,localRows:local,fetcher:fake(A,shared,{revoke:true}),pageSize:2}),/caducó/);
 await assert.rejects(compare({session:session(A),cfg,localRows:local,fetcher:fake(A,shared,{failPage:true}),pageSize:2}),/HTTP 503/);
 const tomb={user_id:A,local_id:'comics:c',metadata:{kind:'comics',deleted:true,deletedAt:'2026-11-20T08:00:00Z'}};
 const t=await compare({session:session(A),cfg,localRows:local,fetcher:fake(A,[...shared,tomb]),pageSize:2});
 assert.equal(t.tombstones,1);assert.equal(t.onlyLocal,0);assert.equal(t.safeToWrite,false);
 console.log('PASS: two isolated accounts, keyset, conflicts, tombstones, revoked auth, failed page; zero writes');
})().catch(e=>{console.error(e);process.exitCode=1});
