'use strict';
/* MI COMICTECA — safe two-way comic sync core.
 * Manual invocation ONLY. No automatic cloud writes, deletions or cover uploads.
 * The production UI remains gated until isolated E2E with 2 users + private covers.
 * Per-comic base snapshot and CAS (updated_at) prevent blind overwrites.
 */
(function(root){
 const PREFIX='mc-sync-v3-baseline-', PAGE_SIZE=250, MAX_PAGES=1000;
 function assert(ok,msg){if(!ok)throw Error(msg)}
 function canonical(x){
  function normalize(v,visited){
   if(v===null||typeof v!=='object'){
    assert(typeof v!=='undefined'&&typeof v!=='function'&&typeof v!=='symbol'&&typeof v!=='bigint',
      'Unserializable field in comic');
    if(typeof v==='number')assert(Number.isFinite(v),'Invalid number in comic');
    return v;
   }
   assert(!visited.has(v),'Cyclic comic');
   visited.add(v);
   try{
    if(Array.isArray(v))return v.map(a=>normalize(a,visited));
    const proto=Object.getPrototypeOf(v);
    assert(proto===Object.prototype||proto===null,'Non-plain object in comic');
    const result={};
    for(const key of Object.keys(v).sort())result[key]=normalize(v[key],visited);
    return result;
   }finally{visited.delete(v)}
  }
  return JSON.stringify(normalize(x,new Set()));
 }
 function indexed(records,key='id'){
  const out=new Map();
  for(const r of records){
   const id=String(r?.[key]??'');
   assert(id&&id!=='undefined'&&id!=='null','Invalid comic identifier');
   assert(!out.has(id),'Repeated comic identifier '+id);
   out.set(id,r);
  }
  return out;
 }
 function plan(localRows,remoteRows,baselineEntries={},threeWay){
  assert(Array.isArray(localRows)&&Array.isArray(remoteRows),'Invalid sync inputs');
  const local=indexed(localRows),remote=indexed(remoteRows.map(x=>({id:x.record?.id,...x})));
  const base=baselineEntries||{};
  const toCloud=[],toLocal=[],ack=[],conflicts=[];
  const ids=new Set([...local.keys(),...remote.keys(),...Object.keys(base)]);
  for(const id of ids){
   const l=local.get(id),r=remote.get(id),b=base[id];
   const remoteRecord=r?.record;
   if(r?.deleted){conflicts.push({id,reason:'remote-tombstone-needs-review'});continue}
   if(b&&!r){conflicts.push({id,reason:'baseline-record-missing-from-cloud'});continue}
   if(b&&!l){conflicts.push({id,reason:'baseline-record-missing-locally'});continue}
   if(!l&&!r)continue;
   if(!l){toLocal.push({id,record:remoteRecord,expected:null,version:r.version});continue}
   if(!r){toCloud.push({id,record:l,mode:'insert',expectedVersion:null});continue}
   const left=canonical(l),right=canonical(remoteRecord);
   if(left===right){ack.push({id,record:l,version:r.version});continue}
   if(!b?.record){conflicts.push({id,reason:'different-first-sync-versions'});continue}
   const baseString=canonical(b.record);
   if(left===baseString){toLocal.push({id,record:remoteRecord,expected:l,version:r.version});continue}
   if(right===baseString){
    toCloud.push({id,record:l,mode:'update',expectedVersion:r.version});
    continue;
   }
   if(typeof threeWay!=='function'){
    conflicts.push({id,reason:'concurrent-edits'});continue;
   }
   const merged=threeWay(b.record,l,remoteRecord);
   if(merged?.status!=='merged'||!merged.record){
    conflicts.push({id,reason:merged?.reason||'unresolved-concurrent-edits',fields:merged?.fields});continue;
   }
   const chosen=merged.record;
   if(canonical(chosen)===right){
    toLocal.push({id,record:chosen,expected:l,version:r.version});
   }else if(canonical(chosen)===left){
    toCloud.push({id,record:chosen,mode:'update',expectedVersion:r.version});
   }else{
    toCloud.push({id,record:chosen,mode:'update',expectedVersion:r.version,localExpected:l});
   }
  }
  return {toCloud,toLocal,ack,conflicts,totalLocal:local.size,totalCloud:remote.size};
 }
 function getRows(database,table){
  return new Promise((resolve,reject)=>{
   const req=database.transaction(table,'readonly').objectStore(table).getAll();
   req.onsuccess=()=>resolve(req.result||[]);
   req.onerror=()=>reject(req.error||Error('IndexedDB read failed'));
  });
 }
 function getKey(database,table,key){
  return new Promise((resolve,reject)=>{
   const req=database.transaction(table,'readonly').objectStore(table).get(key);
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||Error('IndexedDB lookup failed'));
  });
 }
 async function verifySession({session,cfg,fetcher=fetch}){
  const uid=String(session?.user?.id||''),token=session?.access_token;
  assert(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(uid)&&token,'User session required');
  assert(/^https:\/\/[^/?#]+\/?$/.test(String(cfg?.url||''))&&cfg?.publishableKey,'Invalid cloud endpoint');
  const response=await fetcher(cfg.url.replace(/\/+$/,'')+'/auth/v1/user',{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+token},cache:'no-store'});
  assert(response.ok,'Cloud identity verification failed (HTTP '+response.status+')');
  const who=await response.json();
  assert(who?.id===uid,'Cloud identity differs from local user');
  return uid;
 }
 async function scan({session,cfg,fetcher=fetch,onProgress=()=>{}}){
  const uid=await verifySession({session,cfg,fetcher}),base=cfg.url.replace(/\/+$/,'');
  const rows=[],seen=new Set();let last=null,complete=false;
  const headers={apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token};
  for(let i=0;i<MAX_PAGES;i++){
   const query='?select=user_id,local_id,metadata,updated_at&user_id=eq.'+encodeURIComponent(uid)+'&order=local_id.asc&limit='+PAGE_SIZE+
      (last===null?'':'&local_id=gt.'+encodeURIComponent(last));
   const result=await fetcher(base+'/rest/v1/user_comics'+query,{headers,cache:'no-store'});
   assert(result.ok,'Cloud listing failed (HTTP '+result.status+')');
   const batch=await result.json();
   assert(Array.isArray(batch)&&batch.length<=PAGE_SIZE,'Invalid cloud page');
   for(const x of batch){
    assert(x.user_id===uid,'Cross-user cloud data rejected');
    const k=x.local_id;
    assert(typeof k==='string'&&k&&(last===null||k>last)&&!seen.has(k),'Unstable cloud pagination');
    last=k;seen.add(k);
    if(!k.startsWith('comics:'))continue;
    const meta=x.metadata||{};
    assert(meta.kind==='comics'&&meta.record?.id&&String(meta.record.id)===k.slice(7),'Invalid cloud comic record');
    assert(typeof x.updated_at==='string'&&Number.isFinite(Date.parse(x.updated_at)),'Invalid cloud version');
    rows.push({record:meta.record,version:x.updated_at,deleted:meta.deleted===true});
   }
   onProgress({stage:'reading',scanned:seen.size,comics:rows.length,pages:i+1});
   if(batch.length<PAGE_SIZE){complete=true;break}
  }
  assert(complete,'Incomplete cloud scan: no writes authorized');
  await verifySession({session,cfg,fetcher});
  return rows;
 }
 async function pushOne({session,cfg,fetcher=fetch,item}){
  const body={p_local_id:'comics:'+item.id,p_record:item.record,p_mode:item.mode,p_expected_updated_at:item.expectedVersion};
  const resp=await fetcher(cfg.url.replace(/\/+$/,'')+'/rest/v1/rpc/mc_sync_comic_v3',{
   method:'POST',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
   cache:'no-store',body:JSON.stringify(body)
  });
  assert(resp.ok,'Cloud save failed (HTTP '+resp.status+')');
  const result=await resp.json();
  assert(result?.state==='saved'&&result.local_id===body.p_local_id&&typeof result.updated_at==='string',
    'Cloud record not saved: '+String(result?.state||'unknown'));
  return result.updated_at;
 }
 function atomicLocalApply({database,original,updates,baseline,uid}){
  return new Promise((resolve,reject)=>{
   let tx;
   try{
    tx=database.transaction(['comics','settings'],'readwrite');
    const comics=tx.objectStore('comics'),settings=tx.objectStore('settings');
    const before=new Map(original.map(r=>[String(r.id),canonical(r)]));
    let checked=0,aborted=false;
    const stop=()=>{aborted=true;try{tx.abort()}catch(_){}};
    for(const item of updates){
     const req=comics.get(item.id);
     req.onsuccess=()=>{
      if(aborted)return;
      try{
       const was=before.get(item.id),is=req.result===undefined?undefined:canonical(req.result);
       if(was!==is){stop();return}
       comics.put(item.record);
       checked++;
      }catch(_){stop()}
     };
     req.onerror=stop;
    }
    // The baseline write executes in the SAME transaction as the catalogue changes.
    // An aborted local transfer never claims a cloud version was acknowledged.
    settings.put({key:PREFIX+uid,uid,entries:baseline,version:3,updatedAt:new Date().toISOString()});
    tx.oncomplete=()=>resolve(checked);
    tx.onabort=()=>reject(Error('Local sync was rolled back; no existing comic overwritten'));
    tx.onerror=()=>{};
   }catch(e){reject(e)}
  });
 }
 async function sync({database,dbName,session,cfg,fetcher=fetch,onProgress=()=>{},confirmWrites=false,coverGate}={}){
  assert(confirmWrites===true,'Write access requires explicit user confirmation');
  const uid=await verifySession({session,cfg,fetcher});
  assert(dbName==='comicteca-user-'+uid,'IndexedDB belongs to another account');
  const local=await getRows(database,'comics'),remote=await scan({session,cfg,fetcher,onProgress});
  const settings=await getKey(database,'settings',PREFIX+uid);
  const baseline=settings?.uid===uid&&settings.version===3?settings.entries||{}:{};
  const planResult=plan(local,remote,baseline,root.MCReconcileV2?.threeWay);
  const stats={local:local.length,cloud:remote.length,downloads:0,uploads:0,conflicts:[...planResult.conflicts],coversPending:0};
  const old=new Map(local.map(x=>[String(x.id),x]));
  const cloud=new Map(remote.map(x=>[String(x.record.id),x]));
  const nextBaseline={...baseline};
  const localUpdates=[...planResult.toLocal];
  for(const row of planResult.ack)nextBaseline[row.id]={record:row.record,version:row.version};
  // Every upload is individually conditional. No blind upserts or cloud deletes.
  for(const item of planResult.toCloud){
   onProgress({stage:'uploading',uploaded:stats.uploads,total:planResult.toCloud.length});
   try{
    const current=await getKey(database,'comics',item.id);
    if(!current||canonical(current)!==canonical(old.get(item.id)))throw Error('local-record-changed-during-sync');
    // A new or changed local private cover must be uploaded + SHA-verified FIRST.
    const former=cloud.get(item.id)?.record;
    const coverChanged=String(former?.coverKey||'')!==String(item.record.coverKey||'');
    if(item.record.coverKey&&coverChanged){
      if(typeof coverGate!=='function')throw Error('private-cover-transfer-not-verified');
      await coverGate(item.record,uid,session,cfg);
    }
    const version=await pushOne({session,cfg,fetcher,item});
    stats.uploads++;
    nextBaseline[item.id]={record:item.record,version};
    // In a three-way merge, also stage the chosen record locally.
    if(item.localExpected)localUpdates.push({id:item.id,record:item.record,expected:item.localExpected,version});
   }catch(e){stats.conflicts.push({id:item.id,reason:String(e.message||e)});}
  }
  // Never call delete on either device; a missing record is not a deletion.
  for(const item of localUpdates){
   if(item.record?.coverKey){
    // Metadata is preserved, but private binary images need a separate verified transfer.
    stats.coversPending++;
   }
   if(!nextBaseline[item.id]){
    nextBaseline[item.id]={record:item.record,version:item.version};
   }
  }
  const conflicted=new Set(stats.conflicts.map(x=>x.id));
  const validUpdates=localUpdates.filter(x=>!conflicted.has(x.id));
  for(const x of validUpdates)nextBaseline[x.id]={record:x.record,version:x.version||nextBaseline[x.id]?.version};
  for(const x of stats.conflicts)delete nextBaseline[x.id]; // Never ack an unresolved record.
  await verifySession({session,cfg,fetcher});
  await atomicLocalApply({database,original:local,updates:validUpdates,baseline:nextBaseline,uid});
  stats.downloads=validUpdates.length;
  onProgress({stage:'done',...stats});
  return stats;
 }
 const api={canonical,plan,verifySession,scan,pushOne,atomicLocalApply,sync};
 root.MCSyncV3Core=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);