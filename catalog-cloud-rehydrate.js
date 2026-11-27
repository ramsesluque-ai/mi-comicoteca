'use strict';
/* Empty-local-catalog bootstrap.
 * This is NOT bidirectional sync. It never writes to Supabase or CoverVault.
 * It performs an authenticated, complete cloud read and ADD-ONLY restore into
 * an EMPTY account-specific IndexedDB using one atomic transaction.
 * Existing local catalogs are NEVER merged, replaced or cleared.
 */
(function(root){
 const PAGE=250,MAX_PAGES=2000,SESSION_KEY='mc_supabase_session_v1';
 function assert(ok,message){if(!ok)throw Error(message)}
 function getAccountSession(uid){
  for(const store of [localStorage,sessionStorage]){
   try{
    const session=JSON.parse(store.getItem(SESSION_KEY)||'null');
    if(session?.user?.id===uid&&session.access_token)return session;
   }catch(_){}
  }
  throw Error('La sesión no coincide con la base local. Entra de nuevo en tu cuenta.');
 }
 function countLocal(database){
  return new Promise((resolve,reject)=>{
   const request=database.transaction('comics','readonly').objectStore('comics').count();
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error||Error('IndexedDB no disponible'));
  });
 }
 async function scanCloud({uid,cfg,fetcher,verify,progress}){
  assert(/^[0-9a-f-]{36}$/i.test(uid),'Identidad de cuenta inválida');
  assert(cfg?.url&&cfg?.publishableKey,'Configuración cloud ausente');
  const authenticated=await verify();
  assert(authenticated?.id===uid,'La identidad verificada no coincide con la base local.');
  const rows=[],seen=new Set(),versions=new Map();
  let last=null,complete=false,tombstones=0;
  const base=String(cfg.url).replace(/\/+$/,'');
  for(let page=0;page<MAX_PAGES;page++){
   const query='?select=user_id,local_id,metadata,updated_at&user_id=eq.'+encodeURIComponent(uid)+'&order=local_id.asc&limit='+PAGE+(last===null?'':'&local_id=gt.'+encodeURIComponent(last));
   const request=()=>fetcher(base+'/rest/v1/user_comics'+query,{method:'GET',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+getAccountSession(uid).access_token},cache:'no-store'});
   let response=await request();
   if(response.status===401||response.status===403){
    // Mid-scan JWT expiry must not abort a valid 16k-record restore.
    // Refresh once, verify the SAME identity, and retry the exact GET only.
    const refreshed=await root.CommercialBilling?.refreshSession?.();
    assert(refreshed?.user?.id===uid,'No se pudo renovar el acceso a esta cuenta. Inicia sesión de nuevo.');
    const renewed=await verify();
    assert(renewed?.id===uid,'La sesión cambió mientras se leía la colección.');
    response=await request();
   }
   assert(response.ok,'La colección de Supabase no está disponible (HTTP '+response.status+'). No se han modificado datos.');
   const batch=await response.json();
   assert(Array.isArray(batch)&&batch.length<=PAGE,'Supabase devolvió una página de fichas inválida.');
   for(const x of batch){
    assert(x?.user_id===uid,'Supabase devolvió una fila de otro usuario.');
    const key=x.local_id;
    assert(typeof key==='string'&&key.length>0&&(last===null||key>last)&&!seen.has(key),'Paginación inconsistente o local_id duplicado.');
    last=key;seen.add(key);
    if(!key.startsWith('comics:'))continue;
    const m=x.metadata||{},id=key.slice(7);
    assert(m.kind==='comics'&&id,'Clave de cómic sin tipo o ID válido.');
    if(m.deleted===true){tombstones++;continue;}
    assert(m.record&&typeof m.record==='object'&&String(m.record.id)===id,'Ficha remota incompleta o con ID distinto.');
    rows.push(m.record);
    if(typeof x.updated_at==='string'&&Number.isFinite(Date.parse(x.updated_at)))versions.set(id,x.updated_at);
   }
   progress?.(rows.length);
   if(batch.length<PAGE){complete=true;break;}
  }
  assert(complete,'La lectura de Supabase ha quedado incompleta; restauración cancelada.');
  return {rows,versions,tombstones,scanned:seen.size};
 }
 async function verifiedSnapshot(rows,hasher=crypto.subtle.digest.bind(crypto.subtle)){
  const payload=JSON.stringify(rows);
  assert(typeof payload==='string','No se pudo verificar el respaldo cloud');
  const bytes=new TextEncoder().encode(payload);
  const digest=await hasher('SHA-256',bytes);
  const sha=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  assert(sha.length===64,'No se pudo verificar el SHA-256 del respaldo');
  return {sha,count:rows.length,bytes:bytes.length};
 }
 function restoreAtomically(database,rows){
  return new Promise((resolve,reject)=>{
   let transaction,checked=false;
   try{
    transaction=database.transaction('comics','readwrite');
    const store=transaction.objectStore('comics');
    const count=store.count();
    count.onsuccess=()=>{
     if(count.result!==0){
      transaction.abort();
      return;
     }
     checked=true;
     for(const row of rows)store.add(row); // never put; a collision aborts the whole transaction
    };
    transaction.oncomplete=()=>resolve(rows.length);
    transaction.onabort=()=>reject(Error(checked?'Restauración cancelada sin aplicar cambios (transacción revertida).':'La colección local cambió mientras se recuperaba; no se ha sobrescrito.'));
    transaction.onerror=()=>{}; // onabort owns error reporting
   }catch(e){reject(e)}
  });
 }

 // Add-only reconciliation for a POPULATED account cache. Never uses put/delete,
 // never sends writes to the server and never changes an existing local row.
 // The complete authenticated cloud scan finishes BEFORE this transaction.
 function mergeMissingAtomically(database,rows,uid,versions=new Map()){
  return new Promise((resolve,reject)=>{
   let transaction,added=0,present=0,onlyLocal=0;
   try{
    const withBaseline=database.objectStoreNames?.contains('sync_baseline')===true;
    transaction=database.transaction(withBaseline?['comics','sync_outbox','sync_baseline']:['comics','sync_outbox'],'readwrite');
    const store=transaction.objectStore('comics');
    const pending=transaction.objectStore('sync_outbox').getAll();
    const keys=store.getAllKeys();
    const baseline=withBaseline?transaction.objectStore('sync_baseline'):null;
    const known=baseline?.getAll();
    let existingKeys=null,queuedIds=null,knownIds=baseline?null:new Set();
    const reconcile=()=>{
     if(!existingKeys||!queuedIds||!knownIds)return;
     const existing=new Set(existingKeys.map(String));
     const cloudIds=new Set(rows.map(row=>String(row.id)));
     onlyLocal=[...existing].filter(id=>!cloudIds.has(id)).length;
     for(const row of rows){
      const id=String(row?.id??'');
      if(!id){transaction.abort();return}
      if(existing.has(id)){present++;continue}
      // Local deletions are durable intent. Add-only cloud recovery must never resurrect them.
      if(queuedIds.has(id))continue;
      existing.add(id);store.add(row);added++;
      // The authenticated remote snapshot is the common ancestor of this new
      // cached record. Capture it atomically, without replacing an existing
      // baseline or claiming that a private cover binary has been restored.
      const version=versions.get(id);
      if(baseline&&version&&!knownIds.has(id)){
       baseline.add({id,uid,record:row,version,at:new Date().toISOString()});
       knownIds.add(id);
      }
     }
    };
    keys.onsuccess=()=>{existingKeys=keys.result;reconcile()};
    pending.onsuccess=()=>{queuedIds=new Set(pending.result.map(x=>String(x.id)));reconcile()};
    if(known){known.onsuccess=()=>{knownIds=new Set(known.result.map(x=>String(x.id)));reconcile()};known.onerror=()=>transaction.abort()}
    keys.onerror=()=>transaction.abort();
    pending.onerror=()=>transaction.abort();
    transaction.oncomplete=()=>resolve({added,present,onlyLocal});
    transaction.onabort=()=>reject(Error('Reconciliación cancelada y revertida: '+(transaction.error?.message||'colisión o error de almacenamiento')));
    transaction.onerror=()=>{};
   }catch(e){reject(e)}
  });
 }
 let refreshInFlight=null,refreshInFlightUid=null,refreshLastStarted=0;
 async function refreshAddOnly({database,dbName,uid,cfg,fetcher=fetch,verify=()=>root.CommercialBilling?.currentUser(),hasher}={}){
  assert(database&&uid&&dbName==='comicteca-user-'+uid,'Identidad de la base local no coincide');
  if(refreshInFlight){assert(refreshInFlightUid===uid,'La recuperación en curso pertenece a otra cuenta');return refreshInFlight;}
  refreshLastStarted=Date.now();
  refreshInFlightUid=uid;
  refreshInFlight=(async()=>{
   const before=await countLocal(database);
   const result=await scanCloud({uid,cfg,fetcher,verify});
   // Reject an incomplete or unexpectedly empty remote read; never infer deletion.
   let remembered=0;
   try{remembered=Number(localStorage.getItem('mc-catalog-cloud-seen-'+uid)||0)}catch(_){}
   const owner='0bcbe06d-263d-4ac1-a516-355d27d417f1';
   if(uid===owner)assert(result.rows.length>=16523,'Lectura parcial del catálogo verificado (16.523 fichas); no se modificó IndexedDB.');
   assert(result.rows.length>0||remembered===0,'Supabase devolvió una colección vacía inesperada.');
   assert(result.rows.length>=remembered,'Supabase devolvió menos fichas que el último recuento seguro. Reconciliación detenida.');
   if(!result.rows.length)return {state:'cloud-empty',before,added:0,after:before,cloud:0};
   // Prove that the remote snapshot is fully serializable before any IndexedDB write.
   const proof=await verifiedSnapshot(result.rows,hasher);
   const account=getAccountSession(uid),verified=await verify();
   assert(account?.user?.id===uid&&verified?.id===uid&&dbName==='comicteca-user-'+uid,'La sesión cambió durante la lectura; ninguna ficha importada.');
   const ids=new Set();
   for(const row of result.rows){
    const id=String(row?.id??'');
    assert(id&&!ids.has(id),'ID remoto repetido o inválido; ninguna ficha importada.');
    ids.add(id);
   }
   const merged=await mergeMissingAtomically(database,result.rows,uid,result.versions);
   const after=await countLocal(database);
   assert(after>=before,'La reconciliación no debe eliminar fichas locales.');
   try{localStorage.setItem('mc-catalog-cloud-seen-'+uid,String(result.rows.length))}catch(_){}
   return {state:'add-only-reconciled',before,after,cloud:result.rows.length,added:merged.added,
     kept:merged.present,onlyLocal:merged.onlyLocal,sha256:proof.sha,coverBinariesRestored:false,cloudWrites:false};
  })();
  try{return await refreshInFlight}finally{refreshInFlight=null;refreshInFlightUid=null}
 }
 function notifyPartial(title,message,permanent=false){
  if(!root.document?.body)return;
  let el=root.document.getElementById('mc-add-only-cloud-status');
  if(!el){
   el=root.document.createElement('aside');el.id='mc-add-only-cloud-status';
   el.setAttribute('role','status');el.setAttribute('aria-live','polite');
   el.style.cssText='position:fixed;bottom:14px;left:14px;z-index:99990;max-width:min(460px,calc(100vw - 28px));background:#102b43;border:1px solid #6eb6d5;color:#fff;padding:11px 14px;border-radius:9px;font:13px/1.5 system-ui;box-shadow:0 2px 14px #0017';
   root.document.body.appendChild(el);
  }
  el.textContent=title+': '+message;
  if(!permanent)setTimeout(()=>{if(el.isConnected)el.remove()},9000);
 }
 async function safeBackgroundRefresh(options){
  try{
   const r=await refreshAddOnly(options);
   // Background reconciliation is transparent: never expose internal counts,
   // pending uploads, Supabase or private-cover diagnostics to end users.
   // Preserve the merge event so the UI can refresh normally.
   if(r.added>0){
    root.dispatchEvent?.(new CustomEvent('mc-catalog-cloud-merged',{detail:r}));
   }
   if(r.onlyLocal>0){
    console.info('MI COMICTECA: fichas locales aún no confirmadas en nube',{count:r.onlyLocal});
   }
   return r;
  }catch(e){
   console.warn('MI COMICTECA: recuperación aditiva sin cambios en la nube',e);
   // The local catalog remains usable. No technical toast or persistent
   // banner; retry happens on the next normal refresh.
   return {state:'cloud-unavailable',error:String(e.message||e)};
  }
 }

 function showMessage(title,message,allowRetry){
  let el=document.getElementById('mc-catalog-startup-status');
  if(!el){
   el=document.createElement('section');el.id='mc-catalog-startup-status';
   el.setAttribute('role','status');el.setAttribute('aria-live','polite');
   // Keep the recovery message visible even if another module re-renders #view.
   // The account modal has z-index 100000, so it remains accessible.
   el.style.cssText='position:fixed;inset:0;z-index:99998;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;border:0;background:#071625;box-sizing:border-box;color:#fff;font:16px/1.5 system-ui;text-align:center';
   document.body.appendChild(el);
  }
  el.replaceChildren();
  const heading=document.createElement('h2');heading.textContent=title;
  const paragraph=document.createElement('p');paragraph.textContent=message;
  el.append(heading,paragraph);
  if(allowRetry){
   const btn=document.createElement('button');btn.textContent='Reintentar carga de mi colección';btn.className='btn primary';btn.onclick=()=>location.reload();el.append(btn);
   const login=document.createElement('button');login.className='btn';
   login.textContent='Iniciar sesión de nuevo';
   login.onclick=()=>root.CommercialBilling?.show?.();
   el.append(login);
  }
 }
 async function bootstrap({database,dbName,uid,cfg,fetcher=fetch,verify=()=>root.CommercialBilling?.currentUser(),onState=showMessage,hasher}={}){
  if(!uid||!database)return {state:'guest'};
  assert(dbName==='comicteca-user-'+uid,'La base IndexedDB no pertenece a la cuenta iniciada.');
  const count=await countLocal(database);
  if(count>0){
   // Do not delay an offline/local page behind a 16k-record network scan.
   Promise.resolve().then(()=>safeBackgroundRefresh({database,dbName,uid,cfg,fetcher,verify,hasher}));
   return {state:'local',count,cloudCheckPending:true};
  }
  onState('Comprobando tu colección','La copia local está vacía. Buscando tus fichas en Supabase antes de mostrar el catálogo…');
  let result;
  try{
   result=await scanCloud({uid,cfg,fetcher,verify,progress:n=>onState('Recuperando tu catálogo','Consultando Supabase de forma segura: '+n.toLocaleString('es-ES')+' fichas verificadas…')});
   // A known, nonempty cloud catalog must never be shown as blank on failure.
   let remembered=0;
   try{remembered=Number(localStorage.getItem('mc-catalog-cloud-seen-'+uid)||0)}catch(_){}
   // The original owner's 16,523 archived rows are an independently confirmed
   // recovery baseline, not a cloud write target. A filtered/partial RLS read
   // must never masquerade as a legitimately empty account.
   const owner='0bcbe06d-263d-4ac1-a516-355d27d417f1';
   if(uid===owner)assert(result.rows.length>=16523,'La nube ha devuelto menos fichas de las 16.523 verificadas. No se mostrará un catálogo parcial o vacío.');
   assert(result.rows.length>0||remembered===0,'La colección remota aparece vacía aunque ya existía: carga bloqueada para evitar un falso catálogo nuevo.');
   if(!result.rows.length){
    document.getElementById('mc-catalog-startup-status')?.remove();
    return {state:'new',count:0};
   }
   const snapshot=await verifiedSnapshot(result.rows,hasher);
   const current=getAccountSession(uid);
   assert(current.user.id===uid&&dbName==='comicteca-user-'+uid,'La sesión cambió durante la restauración: operación bloqueada.');
   // This is local rehydration, not cloud synchronization; metadata for private
   // covers is preserved verbatim, but CoverVault binaries are NOT transferred.
   await restoreAtomically(database,result.rows);
   const after=await countLocal(database);
   assert(after===result.rows.length,'La recuperación local no ha superado la verificación de recuento.');
   try{localStorage.setItem('mc-catalog-cloud-seen-'+uid,String(result.rows.length))}catch(_){}
   document.getElementById('mc-catalog-startup-status')?.remove();
   return {state:'restored',count:after,sha256:snapshot.sha,bytes:snapshot.bytes,coversRestored:false};
  }catch(e){
   onState('No podemos mostrar tu colección','No se ha presentado una colección vacía ni se ha modificado Supabase. '+String(e.message||e),true);
   throw e;
  }
 }

 // Explicit recovery plan for a partial local catalog. This function NEVER writes.
 // The original browser records must be backed up outside IndexedDB before a
 // future replacement can be considered; an in-memory hash is not a backup.
 async function previewOwnerReplacement({database,dbName,uid,cfg,fetcher=fetch,verify=()=>root.CommercialBilling?.currentUser(),hasher}={}){
  assert(database&&uid&&dbName==='comicteca-user-'+uid,'La base local no coincide con la cuenta.');
  const local=await new Promise((resolve,reject)=>{
   const tx=database.transaction('comics','readonly');
   const req=tx.objectStore('comics').getAll();
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||Error('No se pudo leer el catálogo local.'));
  });
  const cloud=await scanCloud({uid,cfg,fetcher,verify});
  assert(cloud.rows.length>0,'La nube no ha devuelto fichas; recuperación bloqueada.');
  const owner='0bcbe06d-263d-4ac1-a516-355d27d417f1';
  if(uid===owner)assert(cloud.rows.length>=16523,'Lectura incompleta del catálogo del propietario.');
  const ids=new Set();
  for(const row of cloud.rows){
   const id=String(row?.id??'');
   assert(id&&!ids.has(id),'ID remoto duplicado o vacío; recuperación bloqueada.');
   ids.add(id);
  }
  const localBackup={accountId:uid,createdAt:new Date().toISOString(),records:local};
  const localProof=await verifiedSnapshot(localBackup.records,hasher);
  const remoteProof=await verifiedSnapshot(cloud.rows,hasher);
  // Do not mutate the local store or remote service. Binary covers are NOT restored.
  return {status:'preview-only',localCount:local.length,cloudCount:cloud.rows.length,
   localBackup,localSha256:localProof.sha,remoteSha256:remoteProof.sha,
   coversRestored:false,writeAllowed:false};
 }


 // User-initiated, independently verifiable backup. Never remove local records.
 // Return a Blob as well, so a caller can offer an explicit download.
 async function createVerifiedLocalBackup({database,dbName,uid,hasher=crypto.subtle.digest.bind(crypto.subtle)}={}){
  assert(database&&uid&&dbName==='comicteca-user-'+uid,'La cuenta no coincide con IndexedDB.');
  const records=await new Promise((resolve,reject)=>{
   const tx=database.transaction('comics','readonly');
   const request=tx.objectStore('comics').getAll();
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error||Error('No se pudo leer IndexedDB.'));
  });
  const backup={format:'mi-comicteca-local-comics-backup-v1',uid,createdAt:new Date().toISOString(),records};
  const content=JSON.stringify(backup);
  assert(content&&content.length>0,'No se pudo serializar el respaldo.');
  const bytes=new TextEncoder().encode(content);
  const digest=async data=>Array.from(new Uint8Array(await hasher('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
  const originalHash=await digest(bytes);
  const blob=new Blob([bytes],{type:'application/json'});
  const readback=new Uint8Array(await blob.arrayBuffer());
  assert(readback.length===bytes.length&&await digest(readback)===originalHash,'Falló la verificación del respaldo.');
  const decoded=JSON.parse(new TextDecoder().decode(readback));
  assert(decoded.uid===uid&&decoded.records.length===records.length,'El respaldo no coincide con la colección.');
  return {blob,sha256:originalHash,count:records.length,bytes:bytes.length,
   filename:'mi-comicteca-respaldo-local-'+new Date().toISOString().slice(0,10)+'.json'};
 }

 root.MCCatalogBootstrap={bootstrap,scanCloud,restoreAtomically,verifiedSnapshot,previewOwnerReplacement,createVerifiedLocalBackup,mergeMissingAtomically,refreshAddOnly,safeBackgroundRefresh};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.MCCatalogBootstrap;
})(typeof window!=='undefined'?window:globalThis);
