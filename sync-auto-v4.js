'use strict';
/* MI COMICTECA — V4 automatic sync controller, staged behind explicit integration gate.
 * IndexedDB is the offline working copy; Supabase is the authenticated account cloud.
 * Save events are recorded atomically by app1.js into sync_outbox.
 * No unqueued historical records are ever sent to the cloud.
 * No deletion is inferred from missing rows; no unconditional cloud updates.
 */
(function(root){
 const MAX_UPLOADS=40,OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1';
 const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
 const engine=()=>root.MCSyncV3Core;
 function json(x){return engine().canonical(x)}
 function sessionFromStore(uid){
  for(const storage of [root.localStorage,root.sessionStorage]){
   try{
    const s=JSON.parse(storage.getItem('mc_supabase_session_v1')||'null');
    if(s?.user?.id===uid&&s.access_token)return s;
   }catch(_){}
  }
  throw Error('La sesión no coincide con la colección local');
 }
 // CommercialBilling is responsible for safe JWT renewal (including 403/bad_jwt).
 // Without this check an offline outbox can remain blocked after token expiry.
 async function freshSession(uid){
  if(typeof root.CommercialBilling?.currentUser==='function'){
   const who=await root.CommercialBilling.currentUser();
   assert(who?.id===uid,'La sesión autenticada cambió; sincronización detenida');
  }
  return sessionFromStore(uid);
 }
 function txRows(database,store){
  return new Promise((res,rej)=>{
   const q=database.transaction(store,'readonly').objectStore(store).getAll();
   q.onsuccess=()=>res(q.result||[]);
   q.onerror=()=>rej(q.error||Error('No se pudo leer '+store));
  });
 }
 function txOne(database,store,id){
  return new Promise((res,rej)=>{
   const q=database.transaction(store,'readonly').objectStore(store).get(id);
   q.onsuccess=()=>res(q.result||null);
   q.onerror=()=>rej(q.error||Error('No se pudo consultar '+store));
  });
 }
 function validateIdentity({database,dbName,uid}){
  assert(database&&uid&&dbName==='comicteca-user-'+uid,'Cuenta y base IndexedDB no coinciden');
  assert(['comics','sync_outbox','sync_baseline'].every(n=>database.objectStoreNames.contains(n)),
   'La base local debe actualizarse antes de sincronizar');
 }
 async function lookup({uid,session,cfg,id,fetcher=fetch}){
  assert(/^[a-zA-Z0-9_.:-]{1,180}$/.test(id),'ID de ficha no admitido por la API segura');
  const path='comics:'+id;
  const url=String(cfg.url).replace(/\/+$/,'')+'/rest/v1/user_comics?select=user_id,local_id,metadata,updated_at&user_id=eq.'+
   encodeURIComponent(uid)+'&local_id=eq.'+encodeURIComponent(path)+'&limit=1';
  const response=await fetcher(url,{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token},cache:'no-store'});
  assert(response.ok,'Consulta cloud HTTP '+response.status);
  const batch=await response.json();
  assert(Array.isArray(batch)&&batch.length<=1,'Consulta cloud inconsistente');
  if(!batch.length)return null;
  const row=batch[0];
  assert(row.user_id===uid&&row.local_id===path&&row.metadata?.kind==='comics'&&String(row.metadata.record?.id)===id,
   'Datos remotos de otra cuenta o identificador inválido');
  return {record:row.metadata.record,version:row.updated_at,deleted:row.metadata.deleted===true};
 }
 function decidePull({local,remote,baseline,pending}){
  if(!remote||remote.deleted)return {action:'conflict',reason:'eliminacion-o-ficha-remota-no-disponible'};
  if(pending)return {action:'defer',reason:'cambios-locales-pendientes'};
  if(!local)return {action:'download',record:remote.record,version:remote.version};
  if(json(local)===json(remote.record))return {action:'ack',record:remote.record,version:remote.version};
  if(!baseline?.record)return {action:'conflict',reason:'primera-sincronizacion-con-diferencias'};
  if(json(local)===json(baseline.record))
   return {action:'download',record:remote.record,version:remote.version};
  return {action:'conflict',reason:'cambios-sin-confirmar-o-simultaneos'};
 }
 function decidePush({local,remote,baseline}){
  if(!local)return {action:'conflict',reason:'ficha-local-desaparecida'};
  if(local.deleted===true)return {action:'conflict',reason:'baja-sin-tombstone-validada'};
  if(remote?.deleted)return {action:'conflict',reason:'ficha-eliminada-en-nube'};
  if(!remote)return baseline?{action:'conflict',reason:'ficha-central-desaparecida'}:
   {action:'insert',record:local,mode:'insert',expectedVersion:null};
  if(json(local)===json(remote.record))return {action:'ack',record:remote.record,version:remote.version};
  if(!baseline?.record)return {action:'conflict',reason:'cambios-locales-sin-version-base'};
  if(json(remote.record)!==json(baseline.record))
   return {action:'conflict',reason:'cambio-concurrente-en-la-nube'};
  return {action:'update',record:local,mode:'update',expectedVersion:remote.version};
 }
 function commitLocal(database,{updates,uid}){
  if(!updates.length)return Promise.resolve(0);
  return new Promise((resolve,reject)=>{
   let tx,performed=0,failed=false;
   try{
    tx=database.transaction(['comics','sync_outbox','sync_baseline'],'readwrite');
    const comics=tx.objectStore('comics'),outbox=tx.objectStore('sync_outbox'),baseline=tx.objectStore('sync_baseline');
    const abort=()=>{if(!failed){failed=true;try{tx.abort()}catch(_){}}};
    for(const u of updates){
     const original=comics.get(u.id),pending=outbox.get(u.id);
     let haveComic=false,havePending=false,row,dirty;
     const attempt=()=>{
      if(!haveComic||!havePending||failed)return;
      try{
       if(dirty||!((row===undefined&&u.original===undefined)||(row!==undefined&&u.original!==undefined&&json(row)===json(u.original)))){abort();return}
       if(u.type==='download'){comics.put(u.record);performed++}
       baseline.put({id:u.id,uid,record:u.record,version:u.version,at:new Date().toISOString()});
      }catch(_){abort()}
     };
     original.onsuccess=()=>{row=original.result;haveComic=true;attempt()};
     pending.onsuccess=()=>{dirty=!!pending.result;havePending=true;attempt()};
     original.onerror=abort;pending.onerror=abort;
    }
    tx.oncomplete=()=>resolve(performed);
    tx.onabort=()=>reject(Error('La copia local cambió durante la descarga; transacción revertida'));
    tx.onerror=()=>{};
   }catch(e){reject(e)}
  });
 }
 function ackUpload(database,{uid,id,expectedRev,record,version}){
  return new Promise((resolve,reject)=>{
   try{
    const tx=database.transaction(['comics','sync_outbox','sync_baseline'],'readwrite');
    const comics=tx.objectStore('comics'),outbox=tx.objectStore('sync_outbox'),base=tx.objectStore('sync_baseline');
    let cleared=false,hasComic=false,hasOutbox=false,live,queued,settled=false;
    const abort=()=>{if(!settled){settled=true;try{tx.abort()}catch(_){}}};
    const finalize=()=>{
     if(settled||!hasComic||!hasOutbox)return;
     try{
      if(queued&&queued.uid!==uid){abort();return}
      // Cloud version is acknowledged, but local data may have been edited in
      // another tab while the HTTP request was in flight. Never lose that edit.
      const differs=live===undefined||json(live)!==json(record);
      base.put({id,uid,record,version,at:new Date().toISOString()});
      if(differs){
       if(!queued||queued.rev===expectedRev){
        outbox.put({id,uid,rev:'race-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),
          createdAt:new Date().toISOString(),op:live===undefined?'delete':'save'});
       }
      }else if(queued?.rev===expectedRev){
       outbox.delete(id);cleared=true;
      }
     }catch(_){abort()}
    };
    const a=comics.get(id),b=outbox.get(id);
    a.onsuccess=()=>{live=a.result;hasComic=true;finalize()};
    b.onsuccess=()=>{queued=b.result;hasOutbox=true;finalize()};
    a.onerror=abort;b.onerror=abort;
    tx.oncomplete=()=>resolve(cleared);
    tx.onabort=()=>reject(Error('No se pudo confirmar localmente el envío; cambio pendiente conservado'));
    tx.onerror=()=>{};
   }catch(e){reject(e)}
  });
 }
 async function uploadQueued({database,dbName,uid,cfg,fetcher=fetch,coverTransport,onProgress=()=>{},limit=MAX_UPLOADS}){
  validateIdentity({database,dbName,uid});
  const session=await freshSession(uid);
  await engine().verifySession({session,cfg,fetcher});
  const entries=(await txRows(database,'sync_outbox')).filter(x=>x.uid===uid).slice(0,limit);
  const stats={uploaded:0,acknowledged:0,conflicts:[],pending:entries.length};
  for(const entry of entries){
   const current=await txOne(database,'sync_outbox',entry.id);
   if(!current||current.rev!==entry.rev)continue;
   const local=await txOne(database,'comics',entry.id);
   const baseline=await txOne(database,'sync_baseline',entry.id);
   try{
    const remote=await lookup({uid,session,cfg,id:entry.id,fetcher});
    const decision=decidePush({local,remote,baseline});
    if(decision.action==='conflict'){stats.conflicts.push({id:entry.id,reason:decision.reason});continue}
    if(decision.action==='ack'){
     // Equal record metadata does not prove an image exists in both devices.
     // Verify the private image before marking the queued change acknowledged.
     if(remote.record?.coverKey){
      assert(coverTransport?.upload&&coverTransport?.download,'No existe transporte de portadas verificable');
      try{await coverTransport.upload({record:remote.record,uid,session,cfg,fetcher})}
      catch(error){
       // This device may be missing the image while the cloud already has it.
       // Download can recover that case, but MUST also SHA-verify the bytes.
       await coverTransport.download({record:remote.record,uid,session,cfg,fetcher});
      }
     }
     await ackUpload(database,{uid,id:entry.id,expectedRev:entry.rev,record:remote.record,version:remote.version});
     stats.acknowledged++;continue;
    }
    // Keep original cover bytes safe and private before posting references.
    // A cover URL alone is never evidence of an uploaded cover object.
    if(decision.record?.coverKey){
     assert(typeof coverTransport?.upload==='function','No existe transporte de portadas verificable');
     await coverTransport.upload({record:decision.record,uid,session,cfg,fetcher});
    }
    const newer=await txOne(database,'sync_outbox',entry.id);
    const live=await txOne(database,'comics',entry.id);
    if(!newer||newer.rev!==entry.rev||!live||json(live)!==json(local)){
     stats.conflicts.push({id:entry.id,reason:'modificacion-durante-el-envio'});continue
    }
    const version=await engine().pushOne({session,cfg,fetcher,item:{
      id:entry.id,record:decision.record,mode:decision.mode,expectedVersion:decision.expectedVersion
    }});
    await ackUpload(database,{uid,id:entry.id,expectedRev:entry.rev,record:decision.record,version});
    stats.uploaded++;
   }catch(error){stats.conflicts.push({id:entry.id,reason:String(error.message||error)})}
   onProgress({stage:'upload',...stats});
  }
  stats.pending=(await txRows(database,'sync_outbox')).filter(x=>x.uid===uid).length;
  return stats;
 }
 async function pull({database,dbName,uid,cfg,fetcher=fetch,coverTransport,onProgress=()=>{}}){
  validateIdentity({database,dbName,uid});
  const session=await freshSession(uid);
  await engine().verifySession({session,cfg,fetcher});
  const remote=await engine().scan({session,cfg,fetcher,onProgress});
  // An unexpectedly filtered cloud response must not erase or acknowledge
  // any portion of the owner's archived collection.
  if(uid===OWNER)assert(remote.filter(x=>!x.deleted).length>=16523,'El catálogo central no supera el recuento de seguridad');
  const local=await txRows(database,'comics');
  const baselines=await txRows(database,'sync_baseline');
  const queued=await txRows(database,'sync_outbox');
  const localById=new Map(local.map(x=>[String(x.id),x]));
  const baseById=new Map(baselines.filter(x=>x.uid===uid).map(x=>[String(x.id),x]));
  const dirty=new Set(queued.filter(x=>x.uid===uid).map(x=>String(x.id)));
  const updates=[],conflicts=[];
  for(const r of remote){
   const id=String(r.record.id);
   if(r.deleted){conflicts.push({id,reason:'baja-central-pendiente-de-revision'});continue}
   const original=localById.get(id);
   const decision=decidePull({local:original,remote:r,baseline:baseById.get(id),pending:dirty.has(id)});
   if(decision.action==='conflict'){conflicts.push({id,reason:decision.reason});continue}
   if(decision.action==='defer')continue;
   if((decision.action==='download'||decision.action==='ack')&&decision.record.coverKey){
    if(typeof coverTransport?.download!=='function'){
     conflicts.push({id,reason:'portada-privada-no-verificada'});continue
    }
    try{await coverTransport.download({record:decision.record,uid,session,cfg,fetcher})}
    catch(e){conflicts.push({id,reason:'portada-no-recuperada: '+String(e.message||e)});continue}
   }
   updates.push({id,type:decision.action,original,record:decision.record,version:decision.version});
  }
  await engine().verifySession({session,cfg,fetcher});
  // Commit in bounded transactions. No local records are overwritten if the
  // outbox changed while the authenticated remote snapshot was being read.
  let downloaded=0;
  for(let i=0;i<updates.length;i+=200){
   downloaded+=await commitLocal(database,{updates:updates.slice(i,i+200),uid});
   onProgress({stage:'download',processed:Math.min(i+200,updates.length),total:updates.length,downloaded});
  }
  return {cloud:remote.length,downloaded,conflicts,unchanged:updates.length-downloaded};
 }
 let running=null;
 async function syncNow(options){
  if(running)return running;
  running=(async()=>{
   const sent=await uploadQueued(options);
   const received=await pull(options);
   return {sent,received};
  })();
  try{return await running}finally{running=null}
 }
 const api={decidePull,decidePush,lookup,txRows,txOne,commitLocal,ackUpload,uploadQueued,pull,syncNow};
 root.MCAutoSyncV4=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
