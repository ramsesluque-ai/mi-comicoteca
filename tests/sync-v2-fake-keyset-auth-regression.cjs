'use strict';
// Isolated contract: synthetic accounts only; no credentials, network or owner data.
const assert=require('node:assert/strict');
const {compare}=require('../sync-v2-manual-plan.js');
const UID_A='11111111-1111-4111-8111-111111111111';
const UID_B='22222222-2222-4222-8222-222222222222';
const cfg={url:'https://fake.invalid',publishableKey:'fake-public'};
const session={access_token:'synthetic-token',user:{id:UID_A}};
const localRows=[{id:1,title:'One'},{id:2,title:'Two'}];
const cloudRows=[
 {user_id:UID_A,local_id:'comics:1',metadata:{kind:'comics',record:{id:1,title:'One'}}},
 {user_id:UID_A,local_id:'comics:3',metadata:{kind:'comics',record:{id:3,title:'Three'}}},
 {user_id:UID_A,local_id:'wishlist:4',metadata:{kind:'wishlist'}},
];
async function run({rows=cloudRows,who=UID_A,failPage=false,foreign=false}={}){
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,method:opts.method});
  assert.equal(opts.method,'GET','read-only: GET required');
  assert.equal(opts.headers.Authorization,'Bearer synthetic-token');
  if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:who})};
  if(failPage)return {ok:false,status:503};
  const u=new URL(url),limit=Number(u.searchParams.get('limit'));
  const gt=u.searchParams.get('local_id')?.slice(3);
  assert.equal(u.searchParams.get('user_id'),'eq.'+UID_A);
  const page=rows.filter(x=>!gt||x.local_id>gt).slice(0,limit);
  return {ok:true,json:async()=>page};
 };
 try{return {result:await compare({session,cfg,localRows,fetcher,pageSize:2,maxPages:10}),calls};}
 catch(error){return {error,calls};}
}
(async()=>{
 const ok=await run();
 assert.equal(ok.result.complete,true);
 assert.equal(ok.result.safeToWrite,false);
 assert.deepEqual([ok.result.local,ok.result.cloud,ok.result.equal,ok.result.onlyLocal,ok.result.onlyCloud,ok.result.otherKinds],[2,2,1,1,1,1]);
 assert.equal(ok.calls.length,3); // auth + full page + final partial page
 assert(ok.calls.every(x=>x.method==='GET'));
 console.log('PASS two-device-shaped keyset pages; no writes');
 const mismatch=await run({who:UID_B});
 assert.match(mismatch.error.message,/identidad/);
 assert.equal(mismatch.calls.length,1);
 console.log('PASS authenticated account mismatch fails before catalog read');
 const foreign=await run({rows:[{...cloudRows[0],user_id:UID_B}]});
 assert.match(foreign.error.message,/otro usuario/);
 console.log('PASS foreign RLS leakage fails closed');
 const outage=await run({failPage:true});
 assert.match(outage.error.message,/503/);
 console.log('PASS transport error fails closed');
 const duplicate=await run({rows:[cloudRows[0],cloudRows[0]]});
 assert.match(duplicate.error.message,/duplicada|fuera de orden/);
 console.log('PASS duplicate cloud page fails closed');
 const tombstoneRows=[
  {user_id:UID_A,local_id:'comics:1',metadata:{kind:'comics',deleted:true}},
  {user_id:UID_A,local_id:'comics:3',metadata:{kind:'comics',record:{id:3,title:'Three'}}}
 ];
 const tombstone=await run({rows:tombstoneRows});
 assert.equal(tombstone.result.tombstones,1);
 assert.equal(tombstone.result.onlyLocal,1);
 assert.equal(tombstone.result.safeToWrite,false);
 console.log('PASS explicit tombstone is counted but never authorizes deletion');
 const fullPages=await run({rows:[cloudRows[0],cloudRows[1]]});
 assert.equal(fullPages.result.complete,true);
 assert.equal(fullPages.calls.length,3,'exact-full-page must fetch terminal empty page');
 console.log('PASS exact page boundary requires terminal empty page');
 const malformed=await run({rows:[{...cloudRows[0],metadata:{kind:'comics',record:{id:999,title:'wrong'}}}]});
 assert.match(malformed.error.message,/identidad inconsistente/);
 console.log('PASS cloud record ID mismatch fails closed');
 const nonJson=await run();
 assert.equal(nonJson.result.readOnly,true);
 assert.equal(nonJson.result.safeToWrite,false);
 console.log('PASS comparison remains read-only');

})().catch(e=>{console.error(e);process.exitCode=1});
