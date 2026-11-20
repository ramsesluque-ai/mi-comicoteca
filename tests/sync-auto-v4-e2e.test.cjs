'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../sync-v3-core.js');
const sync=require('../sync-auto-v4.js');
const UID='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const cfg={url:'https://example.supabase.co',publishableKey:'pk'};
class MemoryDb {
 constructor(){
  this.stores={comics:new Map(),sync_outbox:new Map(),sync_baseline:new Map()};
  this.objectStoreNames={contains:k=>Object.hasOwn(this.stores,k)};
 }
 transaction(names){
  if(!Array.isArray(names))names=[names];
  const db=this,working=Object.fromEntries(names.map(n=>[n,new Map(db.stores[n])]));
  let pending=0,scheduled=false,failed=false,closed=false;
  const tx={oncomplete:null,onabort:null,onerror:null,error:null,
   objectStore(name){
    const store=working[name];
    if(!store)throw Error('missing store '+name);
    const req=op=>{
     pending++;
     const r={onsuccess:null,onerror:null,result:undefined,error:null};
     queueMicrotask(()=>{
      if(closed)return;
      try{r.result=op();r.onsuccess?.()}
      catch(e){tx.error=e;failed=true;r.onerror?.()}
      finally{pending--;done()}
     });
     return r;
    };
    return {
     get:key=>req(()=>store.get(key)),
     getAll:()=>req(()=>[...store.values()]),
     put:value=>req(()=>{store.set(value.id,value);return value.id}),
     delete:key=>req(()=>store.delete(key))
    };
   },
   abort(){failed=true;done()}
  };
  function done(){
   if(scheduled||closed)return;
   scheduled=true;
   queueMicrotask(()=>queueMicrotask(()=>{
    scheduled=false;
    if(pending||closed)return;
    closed=true;
    if(failed){tx.onabort?.();return}
    for(const n of names)db.stores[n]=working[n];
    tx.oncomplete?.();
   }));
  }
  return tx;
 }
}
function backend(){
 const maps=new Map([[UID,new Map()],[OTHER,new Map()]]);
 const creds={'token-primary':UID,'token-secondary':OTHER};
 let clock=0,failWrites=false;
 const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
 async function fetcher(url,opt={}){
  const uid=creds[String(opt.headers?.Authorization||'').replace(/^Bearer /,'')];
  if(url.includes('/auth/v1/user'))return uid?reply({id:uid}):reply({},401);
  if(!uid)return reply({},401);
  if(url.includes('/rpc/mc_sync_comic_v3')){
   if(failWrites)return reply({error:'offline'},503);
   const req=JSON.parse(opt.body),map=maps.get(uid),before=map.get(req.p_local_id);
   if(req.p_mode==='insert'&&before)return reply({state:'conflict'});
   if(req.p_mode==='update'&&(!before||before.updated_at!==req.p_expected_updated_at))return reply({state:'conflict'});
   const at=new Date(Date.UTC(2026,10,20,10,0,++clock)).toISOString();
   map.set(req.p_local_id,{user_id:uid,local_id:req.p_local_id,metadata:{kind:'comics',record:req.p_record},updated_at:at});
   return reply({state:'saved',local_id:req.p_local_id,updated_at:at});
  }
  if(url.includes('/rest/v1/user_comics')){
   const query=new URL(url).searchParams,map=maps.get(uid);
   let rows=[...map.values()].sort((a,b)=>a.local_id.localeCompare(b.local_id));
   const equal=query.get('local_id')?.startsWith('eq.')?query.get('local_id').slice(3):null;
   const after=query.get('local_id')?.startsWith('gt.')?query.get('local_id').slice(3):null;
   if(equal)rows=rows.filter(x=>x.local_id===equal);
   if(after)rows=rows.filter(x=>x.local_id>after);
   return reply(rows.slice(0,250));
  }
  throw Error('unexpected API '+url);
 }
 return {maps,fetcher,setOffline:x=>{failWrites=x}};
}
function session(uid,token){
 const value={user:{id:uid},access_token:token};
 globalThis.localStorage={getItem:k=>k==='mc_supabase_session_v1'?JSON.stringify(value):null};
 globalThis.sessionStorage={getItem:()=>null};
 return value;
}
test('automatic sync: mobile -> cloud -> PC -> cloud -> mobile, no source sync button',async()=>{
 const server=backend(),mobile=new MemoryDb(),pc=new MemoryDb();
 session(UID,'token-primary');
 const comic={id:'c_abc',title:'Batgirl',issueNr:1,status:'In Collection',notes:''};
 mobile.stores.comics.set(comic.id,comic);
 mobile.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'rev1'});
 const device=database=>({database,dbName:'comicteca-user-'+UID,uid:UID,cfg,fetcher:server.fetcher});
 const first=await sync.uploadQueued(device(mobile));
 assert.equal(first.uploaded,1);
 assert.equal(mobile.stores.sync_outbox.size,0);
 assert.equal(mobile.stores.sync_baseline.size,1);
 assert.equal((await sync.pull(device(pc))).downloaded,1);
 assert.deepEqual(pc.stores.comics.get(comic.id),comic);
 const revised={...comic,notes:'Comprado desde ordenador'};
 pc.stores.comics.set(comic.id,revised);
 pc.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'rev2'});
 assert.equal((await sync.uploadQueued(device(pc))).uploaded,1);
 assert.equal((await sync.pull(device(mobile))).downloaded,1);
 assert.equal(mobile.stores.comics.get(comic.id).notes,revised.notes);
 assert.equal(server.maps.get(OTHER).size,0);
});
test('connection loss retains outbox, retries without data loss',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 const comic={id:'c_offline',title:'Offline comic',coverKey:''};
 device.stores.comics.set(comic.id,comic);
 device.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'offline'});
 const opts={database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,fetcher:server.fetcher};
 server.setOffline(true);
 const first=await sync.uploadQueued(opts);
 assert.equal(first.uploaded,0);
 assert.equal(first.pending,1);
 assert.equal(server.maps.get(UID).size,0);
 server.setOffline(false);
 const second=await sync.uploadQueued(opts);
 assert.equal(second.uploaded,1);
 assert.equal(second.pending,0);
 assert.equal(server.maps.get(UID).size,1);
});
test('two sessions with same record have optimistic concurrency conflicts',async()=>{
 const server=backend(),left=new MemoryDb(),right=new MemoryDb();
 session(UID,'token-primary');
 const comic={id:'c_shared',title:'Same',notes:'Initial'};
 const opts=database=>({database,dbName:'comicteca-user-'+UID,uid:UID,cfg,fetcher:server.fetcher});
 left.stores.comics.set(comic.id,comic);
 left.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'first'});
 await sync.uploadQueued(opts(left));
 await sync.pull(opts(right));
 for(const [database,notes,rev] of [[left,'Phone edit','phone'],[right,'PC edit','pc']]){
  database.stores.comics.set(comic.id,{...comic,notes});
  database.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev});
 }
 assert.equal((await sync.uploadQueued(opts(left))).uploaded,1);
 const r=await sync.uploadQueued(opts(right));
 assert.equal(r.uploaded,0);
 assert.equal(r.conflicts.length,1);
 assert.equal(right.stores.sync_outbox.size,1);
 assert.equal(right.stores.comics.get(comic.id).notes,'PC edit');
 assert.equal(server.maps.get(UID).get('comics:c_shared').metadata.record.notes,'Phone edit');
});
test('a separate account is forbidden from using the first account database',async()=>{
 const db=new MemoryDb();
 session(OTHER,'token-secondary');
 await assert.rejects(sync.uploadQueued({database:db,dbName:'comicteca-user-'+UID,uid:OTHER,cfg,
  fetcher:backend().fetcher}),/no coinciden/);
});
