'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {compare,localIndex,canonical}=require('../sync-v2-manual-plan.js');
const uid='00000000-0000-4000-8000-000000000001',cfg={url:'https://example.supabase.co',publishableKey:'public-test-key'},session={access_token:'test-token',user:{id:uid}};
const make=(i)=>({id:'c'+String(i).padStart(6,'0'),publisher:'ECC',catalogHeader:'Test',issueNr:String(i),title:'Tomo '+i,coverUrl:'https://example.org/'+i+'.jpg'});
const local=Array.from({length:16523},(_,i)=>make(i));
function service(remote,{badUser=false,malformed=false,repeatPage=false,unauthenticated=false}={}){
 let calls=0,history=[];
 return {history,fetcher:async (url,options)=>{
   assert.equal(options.method,'GET','read-only preflight must never write');
   history.push(url);
   if(url.includes('/auth/v1/user'))return{ok:!unauthenticated,status:unauthenticated?401:200,json:async()=>({id:badUser?'wrong-user':uid})};
   const q=new URL(url).searchParams,pageSize=Number(q.get('limit')),after=q.get('local_id')?.slice(3)||null;
   let selected=remote.filter(x=>!after||x.local_id>after).slice(0,pageSize);
   if(repeatPage&&calls++>0)selected=remote.slice(0,pageSize);
   if(malformed&&selected.length)selected[0]={...selected[0],metadata:{kind:'comics',record:{id:'WRONG'}}};
   return {ok:true,status:200,json:async()=>selected};
 }};
}
function cloud(rows){return rows.map(r=>({user_id:uid,local_id:'comics:'+r.id,metadata:{kind:'comics',record:r}})).sort((a,b)=>a.local_id.localeCompare(b.local_id,'en'))}
(async()=>{
 assert.equal(localIndex(local).size,16523);
 assert.deepEqual(canonical({b:1,a:{d:2,c:3}}),canonical({a:{c:3,d:2},b:1}));
 assert.throws(()=>localIndex([{id:'same'},{id:'same'}]),/duplicados/);
 const whole=service(cloud(local)),r=await compare({session,cfg,localRows:local,fetcher:whole.fetcher});
 assert.deepEqual([r.local,r.cloud,r.equal,r.different,r.onlyLocal,r.onlyCloud,r.tombstones,r.complete,r.safeToWrite],[16523,16523,16523,0,0,0,0,true,false]);
 assert(r.pages>60&&whole.history.every(x=>x.includes('/auth/v1/user')||x.includes('user_id=eq.')));
 const edited=local.map(x=>({...x}));
 edited[5]={...edited[5],title:'Cambio en dispositivo'};
 const changedRemote=cloud(local.slice(1));
 const addition=make(18000);
 changedRemote.push(...cloud([addition]));changedRemote.sort((a,b)=>a.local_id.localeCompare(b.local_id,'en'));
 changedRemote[1].metadata.record={...changedRemote[1].metadata.record,title:'Cambio en nube'};
 changedRemote[3].metadata={kind:'comics',deleted:true};
 const state=service(changedRemote);
 const diff=await compare({session,cfg,localRows:edited,fetcher:state.fetcher});
 assert.equal(diff.onlyLocal,2);
 assert.equal(diff.onlyCloud,1);
 assert.equal(diff.tombstones,1);
 assert.equal(diff.different,2);
 assert.equal(diff.equal,16519);
 assert.equal(diff.safeToWrite,false);
 for(const opts of [{badUser:true},{unauthenticated:true},{malformed:true},{repeatPage:true}]){
   const svc=service(cloud(local),opts);
   await assert.rejects(compare({session,cfg,localRows:local,fetcher:svc.fetcher}),/identidad|verificar|inconsistente|fuera de orden/);
 }
 const source=fs.readFileSync('sync-v2-manual-plan.js','utf8');
 assert.doesNotMatch(source,/\b(?:putStore|delStore|bulkPut)\s*\(/);
 assert.doesNotMatch(source,/\bmethod\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
 assert.match(fs.readFileSync('manual-sync-v2-button.js','utf8'),/MCSyncV2ReadPlan\.compare/);
 console.log('SYNC_V2_MANUAL_READ_PLAN_PASS, 16523 records, authentication, keyset and conflicts');
})().catch(e=>{console.error(e);process.exitCode=1});
