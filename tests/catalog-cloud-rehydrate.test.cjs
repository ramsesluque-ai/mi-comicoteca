'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const src=fs.readFileSync(path.join(__dirname,'..','catalog-cloud-rehydrate.js'),'utf8');
const uid='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const key='mc_supabase_session_v1';
function memoryStorage(init={}){
 const m=new Map(Object.entries(init));
 return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};
}
function fakeDb(initial=[]){
 let rows=new Map(initial.map(r=>[r.id,r]));
 let changes=0;
 return {
  get rows(){return rows;},get changes(){return changes;},
  transaction(name,mode){
   assert.equal(name,'comics');
   const tx={oncomplete:null,onabort:null,onerror:null};
   const staged=new Map(rows);
   let aborted=false;
   tx.abort=()=>{aborted=true;queueMicrotask(()=>tx.onabort?.())};
   tx.objectStore=()=>({
    count(){
     const request={result:null,onsuccess:null,onerror:null};
     queueMicrotask(()=>{
      request.result=staged.size;request.onsuccess?.();
      queueMicrotask(()=>{
       if(!aborted){if(mode==='readwrite'){rows=staged;changes++}tx.oncomplete?.();}
      });
     });
     return request;
    },
    add(record){
     if(staged.has(record.id)){tx.abort();return;}
     staged.set(record.id,record);
    }
   });
   return tx;
  }
 };
}
function record(id,extra={}){return {user_id:uid,local_id:'comics:'+id,metadata:{kind:'comics',deleted:false,record:{id,title:'Comic '+id,...extra}}};}
function initialize({cloud=[],sessionUid=uid,wasKnown=0,fetchOverride=null,verifyOverride=null}={}){
 const localStorage=memoryStorage({[key]:JSON.stringify({user:{id:sessionUid},access_token:'TOKEN'}),['mc-catalog-cloud-seen-'+sessionUid]:String(wasKnown)});
 const sessionStorage=memoryStorage();
 const document={getElementById:()=>null};
 const fetchCalls=[];
 const fakeFetch=async(url,opts)=>{
  fetchCalls.push({url,opts});
  if(fetchOverride)return fetchOverride(url,opts);
  const u=new URL(url);
  let rows=cloud;
  const after=u.searchParams.get('local_id');
  if(after&&after.startsWith('gt.'))rows=rows.filter(x=>x.local_id>after.slice(3));
  return {ok:true,status:200,json:async()=>rows.slice(0,250)};
 };
 const window={};
 const sandbox={window,localStorage,sessionStorage,fetch:fakeFetch,document,crypto:webcrypto,TextEncoder,Uint8Array,URL,Error,Array,Promise,console};
 vm.runInNewContext(src,sandbox,{filename:'catalog-cloud-rehydrate.js'});
 const api=window.MCCatalogBootstrap;
 const verify=verifyOverride||(()=>Promise.resolve({id:sessionUid}));
 const run=(database,overrides={})=>api.bootstrap({database,dbName:'comicteca-user-'+sessionUid,uid:sessionUid,cfg:{url:'https://test.invalid',publishableKey:'public'},fetcher:fakeFetch,verify,onState:()=>{},...overrides});
 return {api,run,fetchCalls,localStorage,sessionStorage,window};
}
test('existing catalog is preserved and never replaced or fetched',async()=>{
 const d=fakeDb([{id:'local',title:'Locally edited'}]);
 const x=initialize({cloud:[record('remote')]});
 const v=await x.run(d);
 assert.equal(v.state,'local');
 assert.equal(d.rows.get('local').title,'Locally edited');
 assert.equal(d.changes,0);
 assert.equal(x.fetchCalls.length,0);
});
test('authenticated new empty catalog correctly remains empty',async()=>{
 const d=fakeDb(),x=initialize();
 const result=await x.run(d);
 assert.equal(result.state,'new');
 assert.equal(d.changes,0);
});
test('rehydrates 251 records across keyset pages, only writes locally',async()=>{
 const cloud=Array.from({length:251},(_,i)=>record('id-'+String(i).padStart(4,'0'),{coverKey:'local-cover-'+i,coverUrl:'https://covers.test/'+i}));
 const d=fakeDb(),x=initialize({cloud});
 const v=await x.run(d);
 assert.equal(v.state,'restored');
 assert.equal(v.count,251);
 assert.match(v.sha256,/^[a-f0-9]{64}$/);
 assert.equal(v.coversRestored,false);
 assert.equal(d.rows.size,251);
 assert.equal(d.rows.get('id-0004').coverKey,'local-cover-4');
 assert.equal(d.rows.get('id-0004').coverUrl,'https://covers.test/4');
 assert.equal(d.changes,1);
 assert.equal(x.fetchCalls.length,2);
 assert.ok(x.fetchCalls.every(c=>c.opts.method==='GET'&&c.opts.headers.Authorization==='Bearer TOKEN'));
});
test('cannot restore a cloud record for a different user',async()=>{
 const d=fakeDb(),x=initialize({cloud:[{...record('x'),user_id:other}]});
 await assert.rejects(()=>x.run(d),/otro usuario/);
 assert.equal(d.rows.size,0);
 assert.equal(d.changes,0);
});
test('duplicate keyset, missing and mismatched IDs fail closed',async()=>{
 for(const bad of [[record('a'),record('a')],[{...record('a'),local_id:'comics:b'}],[{...record('a'),metadata:{kind:'comics'}}]]){
  const d=fakeDb(),x=initialize({cloud:bad});
  await assert.rejects(()=>x.run(d));
  assert.equal(d.changes,0);
 }
});
test('tombstones are never resurrected',async()=>{
 const cloud=[record('live'),{...record('deleted'),metadata:{kind:'comics',deleted:true,record:{id:'deleted'}}}];
 const d=fakeDb(),x=initialize({cloud});
 const result=await x.run(d);
 assert.equal(result.count,1);
 assert.ok(d.rows.has('live'));
 assert.ok(!d.rows.has('deleted'));
});
test('network failure cannot create false empty catalog or modify local',async()=>{
 const d=fakeDb(),x=initialize({fetchOverride:async()=>({ok:false,status:503})});
 await assert.rejects(()=>x.run(d),/503/);
 assert.equal(d.rows.size,0);
 assert.equal(d.changes,0);
});
test('previously known remote catalog cannot silently become new empty catalog',async()=>{
 const d=fakeDb(),x=initialize({wasKnown:20});
 await assert.rejects(()=>x.run(d),/aparece vacía/);
 assert.equal(d.rows.size,0);
});
test('changed local DB refuses atomic import and does not overwrite',async()=>{
 const d=fakeDb([{id:'edited',title:'Only on this device'}]),x=initialize({cloud:[record('remote')]});
 await assert.rejects(()=>x.api.restoreAtomically(d,[{id:'remote'}]),/colección local cambió/);
 assert.equal(d.rows.get('edited').title,'Only on this device');
 assert.equal(d.rows.has('remote'),false);
});
test('unexpected identity fails before remote read',async()=>{
 const d=fakeDb(),x=initialize({cloud:[record('a')],verifyOverride:()=>Promise.resolve({id:other})});
 await assert.rejects(()=>x.run(d),/identidad verificada/);
 assert.equal(x.fetchCalls.length,0);
});
test('published page includes bootstrap before DOMContentLoaded and updated worker cache',()=>{
 const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 const app5=fs.readFileSync(path.join(__dirname,'..','app5.js'),'utf8');
 const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
 assert.match(index,/catalog-cloud-rehydrate\.js\?v=20261116-safe-bootstrap2/);
 assert.match(app5,/MCCatalogBootstrap\.bootstrap/);
 assert.match(sw,/comicteca-v132-safe-catalog-bootstrap/);
 assert.match(index,/mi-comicteca-release.*20261116-safe-catalog-bootstrap2/);
});

test('403 caused by token expiry mid-page refreshes and continues same account',async()=>{
 const cloud=[record('a'),record('b')];
 const d=fakeDb(),x=initialize({cloud,fetchOverride:async(url,options)=>{
  const session=JSON.parse(x.localStorage.getItem(key));
  if(session.access_token==='TOKEN')return {ok:false,status:403};
  return {ok:true,status:200,json:async()=>cloud};
 }});
 let renewals=0;
 x.window.CommercialBilling={refreshSession:async()=>{
  renewals++;
  const current=JSON.parse(x.localStorage.getItem(key));
  current.access_token='NEW';
  x.localStorage.setItem(key,JSON.stringify(current));
  return current;
 }};
 const res=await x.run(d);
 assert.equal(res.state,'restored');
 assert.equal(res.count,2);
 assert.equal(renewals,1);
 assert.equal(x.fetchCalls.length,2);
 assert.ok(d.rows.has('a'));
 assert.ok(d.rows.has('b'));
});
test('a failed refresh on HTTP 403 never writes a partial local collection',async()=>{
 const d=fakeDb();
 const x=initialize({fetchOverride:async()=>({ok:false,status:403})});
 x.window.CommercialBilling={refreshSession:async()=>null};
 await assert.rejects(()=>x.run(d),/renovar el acceso/);
 assert.equal(d.changes,0);
 assert.equal(d.rows.size,0);
});
