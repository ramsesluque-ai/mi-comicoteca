'use strict';
// Isolated fake-backend contract tests. No Supabase credentials or owner data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {compare}=require('../sync-v2-manual-plan.js');
// Stable synthetic UUIDs satisfy production identity validation; never real account IDs.
const uid='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const session={user:{id:uid},access_token:'fake-jwt'};
const cfg={url:'https://example.invalid',publishableKey:'fake-public-key'};
const record=id=>({id,title:'Issue '+id});
function backend({rows=[],identity=uid,failAt=0}={}){
 let calls=0;
 return async (url,opts)=>{
   calls++;
   assert.equal(opts.method,'GET','diagnostic must never write');
   assert.equal(opts.headers.Authorization,'Bearer fake-jwt');
   if(failAt===calls)return {ok:false,status:503};
   if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:identity})};
   const parsed=new URL(url);
   assert.equal(parsed.searchParams.get('user_id'),'eq.'+uid);
   const limit=Number(parsed.searchParams.get('limit'));
   const after=parsed.searchParams.get('local_id');
   const gt=parsed.searchParams.get('local_id') && parsed.searchParams.get('local_id').startsWith('gt.') ? parsed.searchParams.get('local_id').slice(3):null;
   const page=rows.filter(r=>gt===null||r.local_id>gt).slice(0,limit);
   return {ok:true,json:async()=>page};
 };
}
test('two simulated sessions compare identical records without writes',async()=>{
 const rows=[1,2,3].map(id=>({user_id:uid,local_id:'comics:'+id,metadata:{kind:'comics',record:record(id)}}));
 const first=await compare({session,cfg,localRows:[record(1),record(2)],fetcher:backend({rows}),pageSize:2});
 const second=await compare({session,cfg,localRows:[record(1),record(2),record(3)],fetcher:backend({rows}),pageSize:2});
 assert.equal(first.equal,2);assert.equal(first.onlyCloud,1);
 assert.equal(second.equal,3);assert.equal(second.onlyCloud,0);
 assert.equal(second.safeToWrite,false);
});
test('foreign user returned by backend fails closed',async()=>{
 const rows=[{user_id:other,local_id:'comics:1',metadata:{kind:'comics',record:record(1)}}];
 await assert.rejects(compare({session,cfg,localRows:[],fetcher:backend({rows})}),/otro usuario/);
});
test('identity mismatch fails closed',async()=>{
 await assert.rejects(compare({session,cfg,localRows:[],fetcher:backend({identity:other})}),/identidad/);
});
test('backend 503 fails closed rather than treating page as empty',async()=>{
 await assert.rejects(compare({session,cfg,localRows:[],fetcher:backend({failAt:2})}),/503/);
});
test('duplicate keys fail closed',async()=>{
 const row={user_id:uid,local_id:'comics:1',metadata:{kind:'comics',record:record(1)}};
 await assert.rejects(compare({session,cfg,localRows:[],fetcher:backend({rows:[row,row]})}),/duplicada|orden/);
});
test('tombstone is not silently downloaded or deleted',async()=>{
 const rows=[{user_id:uid,local_id:'comics:1',metadata:{kind:'comics',deleted:true}}];
 const result=await compare({session,cfg,localRows:[record(1)],fetcher:backend({rows})});
 assert.equal(result.tombstones,1);assert.equal(result.onlyLocal,0);assert.equal(result.safeToWrite,false);
});
