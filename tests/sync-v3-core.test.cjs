'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../sync-v3-core.js');
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const first={id:'c_first',publisher:'ECC',series:'Batman',issueNr:1,notes:'',status:'In Collection'};
const second={id:'c_second',publisher:'Planeta',series:'Batgirl',issueNr:2,notes:'',status:'In Collection'};
const wrap=(record,version='2026-11-20T11:00:00.000Z')=>({record,version,deleted:false});
test('new local comic is a conditional insert; cloud comic is a local download',()=>{
 const upload=core.plan([first],[],{});
 assert.equal(upload.toCloud.length,1);
 assert.equal(upload.toCloud[0].mode,'insert');
 const download=core.plan([],[wrap(first)],{});
 assert.equal(download.toLocal.length,1);
});
test('first reconciliation preserves unresolved edits and still allows disjoint new records',()=>{
 const plan=core.plan([{...first,notes:'Local edit'},second],[wrap(first)],{});
 assert.equal(plan.conflicts.length,1);
 assert.equal(plan.conflicts[0].reason,'different-first-sync-versions');
 assert.deepEqual(plan.toCloud.map(x=>x.id),['c_second']);
});
test('a known baseline sends local-only edits with the current cloud version',()=>{
 const base={c_first:{record:first,version:'2026-11-19T11:00:00.000Z'}};
 const remoteVersion='2026-11-20T11:00:00.000Z';
 const plan=core.plan([{...first,notes:'Bought today'}],[wrap(first,remoteVersion)],base);
 assert.equal(plan.toCloud[0].mode,'update');
 assert.equal(plan.toCloud[0].expectedVersion,remoteVersion);
 assert.equal(plan.toCloud[0].record.notes,'Bought today');
});
test('tombstones and concurrent unresolvable edits fail closed',()=>{
 const base={c_first:{record:first,version:'2026-11-19T11:00:00.000Z'}};
 assert.equal(core.plan([first],[{...wrap(first),deleted:true}],base).conflicts.length,1);
 const plan=core.plan([{...first,notes:'Mobile'}],[wrap({...first,notes:'PC'})],base);
 assert.equal(plan.toCloud.length,0);
 assert.equal(plan.toLocal.length,0);
 assert.equal(plan.conflicts[0].reason,'concurrent-edits');
});
test('canonical signatures tolerate object property order, not field changes',()=>{
 assert.equal(core.canonical({b:1,a:{y:'x',z:2}}),core.canonical({a:{z:2,y:'x'},b:1}));
 assert.notEqual(core.canonical(first),core.canonical({...first,notes:'Edited'}));
 assert.throws(()=>core.canonical({a:undefined}),/Unserializable/);
});
function fakeBackend(){
 const maps=new Map([[A,new Map()],[B,new Map()]]);
 const owners={tokenA:A,tokenB:B};let clock=0;
 const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
 async function fetcher(url,opts={}){
  const uid=owners[String(opts.headers?.Authorization||'').replace(/^Bearer /,'')];
  if(url.includes('/auth/v1/user'))return uid?reply({id:uid}):reply({},401);
  if(!uid)return reply({},401);
  if(url.includes('/rest/v1/user_comics')){
   const q=new URL(url).searchParams,after=q.get('local_id')?.slice(3)||'';
   return reply([...maps.get(uid).values()].filter(r=>r.local_id>after)
     .sort((a,b)=>a.local_id.localeCompare(b.local_id)).slice(0,250));
  }
  if(url.includes('/rpc/mc_sync_comic_v3')){
   const req=JSON.parse(opts.body),map=maps.get(uid),existing=map.get(req.p_local_id);
   if(req.p_mode==='update'&&(!existing||existing.updated_at!==req.p_expected_updated_at))return reply({state:'conflict'});
   if(req.p_mode==='insert'&&existing)return reply({state:'conflict'});
   if(req.p_local_id!=='comics:'+req.p_record.id)return reply({state:'conflict'});
   const updated_at=new Date(Date.UTC(2026,10,20,11,0,++clock)).toISOString();
   map.set(req.p_local_id,{user_id:uid,local_id:req.p_local_id,updated_at,metadata:{kind:'comics',record:req.p_record}});
   return reply({state:'saved',updated_at,local_id:req.p_local_id});
  }
  throw Error('Unexpected mock endpoint');
 }
 return {maps,fetcher};
}
test('two authenticated mock sessions keep separate catalogues, reject stale updates',async()=>{
 const server=fakeBackend(),cfg={url:'https://example.supabase.co',publishableKey:'pk'};
 const sessionA={user:{id:A},access_token:'tokenA'},sessionB={user:{id:B},access_token:'tokenB'};
 const v1=await core.pushOne({session:sessionA,cfg,fetcher:server.fetcher,item:{id:first.id,record:first,mode:'insert'}});
 const rowsA=await core.scan({session:sessionA,cfg,fetcher:server.fetcher});
 const rowsB=await core.scan({session:sessionB,cfg,fetcher:server.fetcher});
 assert.equal(rowsA.length,1);assert.equal(rowsB.length,0);
 assert.equal(core.plan([],rowsA,{}).toLocal.length,1);
 const updated={...first,notes:'Bought on mobile'};
 const v2=await core.pushOne({session:sessionA,cfg,fetcher:server.fetcher,item:{id:first.id,record:updated,mode:'update',expectedVersion:v1}});
 assert.notEqual(v1,v2);
 await assert.rejects(core.pushOne({session:sessionA,cfg,fetcher:server.fetcher,item:{id:first.id,record:first,mode:'update',expectedVersion:v1}}),/conflict/);
 await assert.rejects(core.pushOne({session:sessionB,cfg,fetcher:server.fetcher,item:{id:first.id,record:first,mode:'update',expectedVersion:v2}}),/conflict/);
 assert.equal((await core.scan({session:sessionA,cfg,fetcher:server.fetcher}))[0].record.notes,'Bought on mobile');
});
