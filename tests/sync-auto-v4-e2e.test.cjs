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
     count:()=>req(()=>store.size),
     getAll:()=>req(()=>[...store.values()]),
     getAllKeys:()=>req(()=>[...store.keys()]),
     add:value=>req(()=>{if(store.has(value.id))throw Error('duplicate');store.set(value.id,value);return value.id}),
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

test('identical metadata still requires private cover recovery on device open',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 const comic={id:'c_cover',title:'Comic with cover',coverKey:'c_cover'};
 const version='2026-11-20T11:00:00.000Z';
 server.maps.get(UID).set('comics:c_cover',{
  user_id:UID,local_id:'comics:c_cover',metadata:{kind:'comics',record:comic},updated_at:version
 });
 device.stores.comics.set(comic.id,{...comic});
 let recovered=0;
 const transport={download:async()=>{recovered++;return {verified:true,sha256:'a'.repeat(64)}}};
 const result=await sync.pull({database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,
  fetcher:server.fetcher,coverTransport:transport});
 assert.equal(result.downloaded,0,'metadata was already identical');
 assert.equal(recovered,1,'matching cover reference still downloads/validates binary');
 assert.equal(device.stores.sync_baseline.get(comic.id).version,version);
});
test('acknowledged data must restore a cloud cover if local binary is absent',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 const comic={id:'c_covered',title:'Covered comic',coverKey:'c_covered'};
 const version='2026-11-20T11:00:00.000Z';
 server.maps.get(UID).set('comics:c_covered',{
  user_id:UID,local_id:'comics:c_covered',metadata:{kind:'comics',record:comic},updated_at:version
 });
 device.stores.comics.set(comic.id,{...comic});
 device.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'cover-retry'});
 let uploads=0,downloads=0;
 const transport={
  upload:async()=>{
   uploads++;
   if(downloads===0)throw Error('Portada ausente en local');
   return {verified:true,sha256:'a'.repeat(64)};
  },
  download:async()=>{downloads++;return {verified:true,sha256:'a'.repeat(64)}}
 };
 const args={database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,
  fetcher:server.fetcher,coverTransport:transport};
 const first=await sync.uploadQueued(args);
 assert.equal(first.prepared,1,'first recover binary and stage its verified SHA');
 assert.equal(first.acknowledged,0,'must not acknowledge metadata before cloud SHA');
 assert.equal(downloads,1);
 assert.equal(device.stores.sync_outbox.size,1);
 const result=await sync.uploadQueued(args);
 assert.equal(result.uploaded,1,'second run commits SHA-backed metadata with CAS');
 assert.equal(device.stores.sync_outbox.size,0);
 assert.equal(server.maps.get(UID).get('comics:c_covered').metadata.record.coverSha256,'a'.repeat(64));
 assert.equal(device.stores.comics.get(comic.id).coverSyncPending,false);
});

test('cloud acknowledgment cannot discard a comic edited during the request',async()=>{
 const comic={id:'c_race',title:'Original',notes:'From phone'};
 const later={...comic,notes:'Changed again while uploading'};
 const db=new MemoryDb();
 db.stores.comics.set(comic.id,later);
 db.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'old-rev',op:'save'});
 const acknowledged=await sync.ackUpload(db,{
  uid:UID,id:comic.id,expectedRev:'old-rev',record:comic,
  version:'2026-11-20T11:30:00.000Z'
 });
 assert.equal(acknowledged,false);
 assert.equal(db.stores.comics.get(comic.id).notes,'Changed again while uploading');
 assert.notEqual(db.stores.sync_outbox.get(comic.id).rev,'old-rev');
 assert.equal(db.stores.sync_baseline.get(comic.id).record.notes,'From phone');
});
test('cloud acknowledgment can clear outbox only when the local content matches',async()=>{
 const comic={id:'c_ack',title:'Finished'};
 const db=new MemoryDb();
 db.stores.comics.set(comic.id,comic);
 db.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'same-rev'});
 const cleared=await sync.ackUpload(db,{
  uid:UID,id:comic.id,expectedRev:'same-rev',record:comic,
  version:'2026-11-20T11:45:00.000Z'
 });
 assert.equal(cleared,true);
 assert.equal(db.stores.sync_outbox.size,0);
 assert.equal(db.stores.sync_baseline.get(comic.id).record.title,'Finished');
});
test('newer outbox revision never gets cleared by an older cloud response',async()=>{
 const comic={id:'c_rev',title:'Still edited'};
 const db=new MemoryDb();
 db.stores.comics.set(comic.id,comic);
 db.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'new-rev'});
 const cleared=await sync.ackUpload(db,{
  uid:UID,id:comic.id,expectedRev:'old-rev',record:comic,
  version:'2026-11-20T11:50:00.000Z'
 });
 assert.equal(cleared,false);
 assert.equal(db.stores.sync_outbox.get(comic.id).rev,'new-rev');
});

test('first automatic open establishes remote baseline before pushing new pending saves',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 const existing={id:'c_existing',title:'Already in cloud'};
 const fresh={id:'c_new_offline',title:'Bought offline'};
 server.maps.get(UID).set('comics:c_existing',{
  user_id:UID,local_id:'comics:c_existing',metadata:{kind:'comics',record:existing},
  updated_at:'2026-11-20T11:00:00.000Z'
 });
 device.stores.comics.set(existing.id,existing);
 device.stores.comics.set(fresh.id,fresh);
 device.stores.sync_outbox.set(fresh.id,{id:fresh.id,uid:UID,rev:'pending-new'});
 const stages=[];
 const result=await sync.syncNow({database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,
  fetcher:server.fetcher,onProgress:ev=>stages.push(ev.stage)});
 assert.ok(stages.indexOf('reading')>=0,'first scans authenticated cloud');
 assert.ok(stages.indexOf('upload')>=0,'then transmits locally queued record');
 assert.ok(stages.indexOf('reading')<stages.indexOf('upload'),'cloud read must be first');
 assert.equal(result.sent.uploaded,1);
 assert.equal(device.stores.sync_baseline.get(existing.id).record.title,'Already in cloud');
 assert.equal(server.maps.get(UID).get('comics:c_new_offline').metadata.record.title,'Bought offline');
});
test('an unversioned local edit never overwrites an existing cloud record',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 const original={id:'c_old',title:'Original'};
 const edited={id:'c_old',title:'Different local edit'};
 server.maps.get(UID).set('comics:c_old',{
  user_id:UID,local_id:'comics:c_old',metadata:{kind:'comics',record:original},
  updated_at:'2026-11-20T11:00:00.000Z'
 });
 device.stores.comics.set(original.id,edited);
 device.stores.sync_outbox.set(original.id,{id:original.id,uid:UID,rev:'no-baseline'});
 const result=await sync.syncNow({database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,fetcher:server.fetcher});
 assert.equal(result.sent.uploaded,0);
 assert.equal(result.sent.conflicts[0].reason,'cambios-locales-sin-version-base');
 assert.equal(device.stores.comics.get(original.id).title,'Different local edit');
 assert.equal(server.maps.get(UID).get('comics:c_old').metadata.record.title,'Original');
 assert.equal(device.stores.sync_outbox.size,1);
});

test('unverified cover transport cannot acknowledge a matching comic',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 const comic={id:'c_invalid_cover',title:'Cover with invalid proof',coverKey:'c_invalid_cover'};
 const version='2026-11-20T11:00:00.000Z';
 server.maps.get(UID).set('comics:c_invalid_cover',{
  user_id:UID,local_id:'comics:c_invalid_cover',
  metadata:{kind:'comics',record:comic},updated_at:version
 });
 device.stores.comics.set(comic.id,comic);
 const result=await sync.pull({database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,
  fetcher:server.fetcher,coverTransport:{download:async()=>({verified:false,sha256:''})}});
 assert.equal(result.downloaded,0);
 assert.equal(result.conflicts.length,1);
 assert.equal(device.stores.sync_baseline.size,0);
});
test('a newly saved linked HTTPS cover becomes private in two safe upload stages',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 const original={id:'c_link',title:'Linked comic',coverUrl:'https://publisher.example.com/cover.jpg'};
 device.stores.comics.set(original.id,original);
 device.stores.sync_outbox.set(original.id,{id:original.id,uid:UID,rev:'linked'});
 let prepared=0,uploads=0;
 const transport={
  prepareLinked:async({record})=>{
   prepared++;
   return {...record,coverKey:'c_link-hash',coverSha256:'a'.repeat(64),
    coverSourceUrl:record.coverUrl,coverSyncPending:true};
  },
  upload:async()=>{uploads++;return {verified:true,sha256:'a'.repeat(64)}}
 };
 const args={database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,
  fetcher:server.fetcher,coverTransport:transport};
 const first=await sync.uploadQueued(args);
 assert.equal(first.prepared,1);
 assert.equal(device.stores.comics.get(original.id).coverKey,'c_link-hash');
 assert.equal(device.stores.sync_outbox.size,1);
 const second=await sync.uploadQueued(args);
 assert.equal(second.prepared,1,'binary verified and pending cover flag cleared');
 assert.equal(device.stores.comics.get(original.id).coverSyncPending,false);
 const third=await sync.uploadQueued(args);
 assert.equal(third.uploaded,1);
 assert.equal(device.stores.sync_outbox.size,0);
 assert.equal(prepared,1);
 assert.equal(uploads,2);
 assert.equal(server.maps.get(UID).get('comics:c_link').metadata.record.coverSha256,'a'.repeat(64));
});

test('40 permanent conflicts cannot starve a later new save',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 for(let i=0;i<40;i++){
  const id='blocked_'+i;
  device.stores.sync_outbox.set(id,{id,uid:UID,rev:'delete-'+i,op:'delete'});
 }
 const comic={id:'fresh_save',title:'Must reach cloud'};
 device.stores.comics.set(comic.id,comic);
 device.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'fresh',op:'save'});
 const opts={database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,fetcher:server.fetcher};
 const first=await sync.uploadQueued(opts);
 assert.equal(first.pending,41);
 assert.equal(first.unattempted,1);
 assert.equal(first.conflicts.length,40);
 const next=await sync.uploadQueued(opts);
 assert.equal(next.uploaded,1);
 assert.equal(next.pending,40);
 assert.equal(next.unattempted,0);
 assert.equal(next.retryablePending,0);
 assert.equal(next.conflicts.length,40);
 assert.equal(server.maps.get(UID).size,1);
 assert.equal(server.maps.get(OTHER).size,0);
});
test('transient failure remains retryable alongside a permanent conflict',async()=>{
 const server=backend(),device=new MemoryDb();
 session(UID,'token-primary');
 device.stores.sync_outbox.set('blocked',{id:'blocked',uid:UID,rev:'delete',op:'delete'});
 const comic={id:'fresh',title:'Retry me'};
 device.stores.comics.set(comic.id,comic);
 device.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'fresh'});
 const opts={database:device,dbName:'comicteca-user-'+UID,uid:UID,cfg,fetcher:server.fetcher};
 server.setOffline(true);
 const first=await sync.uploadQueued(opts);
 assert.equal(first.retryablePending,1);
 assert.equal(first.unattempted,0);
 server.setOffline(false);
 const next=await sync.uploadQueued(opts);
 assert.equal(next.uploaded,1);
 assert.equal(next.pending,1);
 assert.equal(next.retryablePending,0);
 assert.equal(next.unattempted,0);
});

// Regression: additive cloud recovery must not discard the common ancestor
// needed by V4 when an existing comic is edited on another device.
test('add-only recovery captures version for newly downloaded rows and protects pending edits',async()=>{
 const rehydrate=require('../catalog-cloud-rehydrate.js');
 const d=new MemoryDb(),first={id:'c_new',title:'Initial'},pending={id:'c_pending',title:'Central'};
 const version='2026-11-27T07:00:00.000Z';
 d.stores.sync_outbox.set(pending.id,{id:pending.id,uid:UID,rev:'pending',op:'delete'});
 const result=await rehydrate.mergeMissingAtomically(d,[first,pending],UID,new Map([[first.id,version],[pending.id,version]]));
 assert.equal(result.added,1);
 assert.deepEqual(d.stores.sync_baseline.get(first.id).record,first);
 assert.equal(d.stores.sync_baseline.get(first.id).version,version);
 assert.equal(d.stores.comics.has(pending.id),false);
 assert.equal(d.stores.sync_outbox.has(pending.id),true);
 const remote={record:{...first,title:'Edited on mobile'},version:'2026-11-27T07:01:00.000Z'};
 assert.equal(sync.decidePull({local:d.stores.comics.get(first.id),remote,baseline:d.stores.sync_baseline.get(first.id),pending:false}).action,'download');
 await rehydrate.mergeMissingAtomically(d,[remote.record],UID,new Map([[first.id,remote.version]]));
 assert.equal(d.stores.comics.get(first.id).title,'Initial');
 assert.equal(d.stores.sync_baseline.get(first.id).version,version);
});

test('empty device bootstrap stores remote baseline atomically and refuses pending local deletes',async()=>{
 const rehydrate=require('../catalog-cloud-rehydrate.js');
 const d=new MemoryDb(),record={id:'c_bootstrap',title:'Original'};
 const version='2026-11-27T07:00:00.000Z';
 await rehydrate.restoreAtomically(d,[record],UID,new Map([[record.id,version]]));
 assert.equal(d.stores.sync_baseline.get(record.id).version,version);
 assert.equal(sync.decidePull({local:record,remote:{record:{...record,title:'Edited'},version:'2026-11-27T08:00:00.000Z'},baseline:d.stores.sync_baseline.get(record.id),pending:false}).action,'download');
 const empty=new MemoryDb();empty.stores.sync_outbox.set(record.id,{id:record.id,uid:UID,op:'delete'});
 await assert.rejects(rehydrate.restoreAtomically(empty,[record],UID,new Map([[record.id,version]])));
 assert.equal(empty.stores.comics.size,0);assert.equal(empty.stores.sync_baseline.size,0);assert.equal(empty.stores.sync_outbox.size,1);
});

test('legacy mobile cache without baseline can send first edit using verified prior record; laptop receives update',async()=>{
 const server=backend(),mobile=new MemoryDb(),laptop=new MemoryDb();session(UID,'token-primary');
 const comic={id:'c_legacy_edit',title:'Original',notes:''},edited={...comic,notes:'Edited from phone'};
 const opts=database=>({database,dbName:'comicteca-user-'+UID,uid:UID,cfg,fetcher:server.fetcher});
 laptop.stores.comics.set(comic.id,comic);laptop.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'first'});
 assert.equal((await sync.uploadQueued(opts(laptop))).uploaded,1);
 mobile.stores.comics.set(comic.id,edited);mobile.stores.sync_outbox.set(comic.id,{id:comic.id,uid:UID,rev:'edit',preEditRecord:comic});
 assert.equal(mobile.stores.sync_baseline.size,0);
 assert.equal((await sync.uploadQueued(opts(mobile))).uploaded,1);
 assert.equal((await sync.pull(opts(laptop))).downloaded,1);
 assert.deepEqual(laptop.stores.comics.get(comic.id),edited);
 assert.equal(mobile.stores.sync_outbox.size,0);assert.equal(server.maps.get(OTHER).size,0);
});
