'use strict';
// Offline two-session regression tests. No production credentials or network access.
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const sandbox={window:{crypto:require('node:crypto').webcrypto},console,URL,encodeURIComponent,Blob,TextEncoder,crypto:require('node:crypto').webcrypto};
vm.createContext(sandbox);
for(const name of ['sync-v2-reconcile.js','sync-v2-manual-plan.js','sync-v2-cover-integrity.js'])
 vm.runInContext(fs.readFileSync(name,'utf8'),sandbox,{filename:name});
const planner=sandbox.window.MCReconcileV2,read=sandbox.window.MCSyncV2ReadPlan,covers=sandbox.window.MCSyncV2CoverIntegrity;
const plain=x=>JSON.parse(JSON.stringify(x));
const A={id:'A',publisher:'Editorial',series:'Serie',issue:'1',title:'Original'};
const B={id:'B',publisher:'Editorial',series:'Serie',issue:'2',title:'Segundo'};
const base=[A,B];
const same=plain(planner.planWithBaseline(base,base,base));
assert.equal(same.conflicts.length,0);
assert.equal(same.unchanged.length,2);
let local=[{...A,title:'Editado local'},B],remote=[{...A,title:'Editado remoto'},B];
assert.equal(planner.planWithBaseline(base,local,remote).conflicts[0].reason,'concurrent-field-edits');
assert.equal(planner.planWithBaseline(base,local,remote).upload.length,0);
assert.equal(planner.planWithBaseline(base,[A],base).conflicts[0].reason,'missing-record-without-tombstone');
assert.equal(planner.planWithBaseline([], [{...A,coverKey:'private'}],[]).conflicts[0].reason,'new-record-cover-unverified');
assert.equal(planner.planWithBaseline([], [A],[{...A,title:'another'}]).conflicts[0].reason,'no-baseline');
assert.equal(planner.planWithBaseline(base,[{...A,deleted:true,deletedAt:'bad'},B],base).conflicts[0].reason,'invalid-tombstone-timestamp');
assert.equal(planner.planWithBaseline(base,[{...A,coverKey:'new'},B],base).conflicts[0].reason,'cover-reference-added-unverified');
assert.equal(planner.planWithBaseline([], [A],[{...A,id:'another'}]).conflicts[0].reason,'duplicate-bibliographic-identity-different-ids');
const u1='00000000-0000-4000-8000-000000000001',u2='00000000-0000-4000-8000-000000000002';
const cfg={url:'https://example.invalid',publishableKey:'test-only'};
function response(data,status=200){return {ok:status===200,status,json:async()=>data}}
function backend(owner,{injectForeign=false,failPage=false}={}){
 const requests=[];
 const fetcher=async(url,opt)=>{
  requests.push({url,method:opt.method});
  assert.equal(opt.method,'GET','Read plan must never write');
  if(url.endsWith('/auth/v1/user'))return response({id:owner});
  if(failPage)return response({error:'network'},503);
  const id=new URL(url).searchParams.get('user_id');
  assert.equal(id,'eq.'+owner);
  const records=injectForeign?[{user_id:owner===u1?u2:u1,local_id:'comics:A',metadata:{kind:'comics',record:A}}]:[{user_id:owner,local_id:'comics:A',metadata:{kind:'comics',record:A}}];
  return response(records);
 };
 return {fetcher,requests};
}
(async()=>{
 for(const uid of [u1,u2]){
  const b=backend(uid);
  const r=await read.compare({session:{user:{id:uid},access_token:'fake'},cfg,localRows:[A],fetcher:b.fetcher});
  assert.equal(r.equal,1);assert.equal(r.safeToWrite,false);assert.equal(r.verifiedUser,true);
  assert.ok(b.requests.every(x=>x.method==='GET'));
 }
 await assert.rejects(read.compare({session:{user:{id:u1},access_token:'fake'},cfg,localRows:[A],fetcher:backend(u1,{injectForeign:true}).fetcher}),/otro usuario/);
 await assert.rejects(read.compare({session:{user:{id:u1},access_token:'fake'},cfg,localRows:[A],fetcher:backend(u1,{failPage:true}).fetcher}),/503/);
 const blob=new Blob(['cover bytes']);
 assert.equal((await covers.verifyPair(blob,new Blob(['cover bytes']))).equal,true);
 assert.equal((await covers.verifyPair(blob,new Blob(['tampered']))).equal,false);
 console.log('PASS: two sessions, owner isolation, HTTP failure, 3-way conflicts, tombstones, cover SHA-256. No production writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
