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
  const rows=[],seen=new Set();
  let last=null,complete=false,tombstones=0;
  const base=String(cfg.url).replace(/\/+$/,'');
  for(let page=0;page<MAX_PAGES;page++){
   const query='?select=user_id,local_id,metadata&user_id=eq.'+encodeURIComponent(uid)+'&order=local_id.asc&limit='+PAGE+(last===null?'':'&local_id=gt.'+encodeURIComponent(last));
   const request=()=>fetcher(base+'/rest/v1/user_comics'+query,{method:'GET',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+getAccountSession(uid).access_token},cache:'no-store'});
   let response=await request();
   if(response.status===401){
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
   }
   progress?.(rows.length);
   if(batch.length<PAGE){complete=true;break;}
  }
  assert(complete,'La lectura de Supabase ha quedado incompleta; restauración cancelada.');
  return {rows,tombstones,scanned:seen.size};
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
  }
 }
 async function bootstrap({database,dbName,uid,cfg,fetcher=fetch,verify=()=>root.CommercialBilling?.currentUser(),onState=showMessage,hasher}={}){
  if(!uid||!database)return {state:'guest'};
  assert(dbName==='comicteca-user-'+uid,'La base IndexedDB no pertenece a la cuenta iniciada.');
  const count=await countLocal(database);
  if(count>0)return {state:'local',count};
  onState('Comprobando tu colección','La copia local está vacía. Buscando tus fichas en Supabase antes de mostrar el catálogo…');
  let result;
  try{
   result=await scanCloud({uid,cfg,fetcher,verify,progress:n=>onState('Recuperando tu catálogo','Consultando Supabase de forma segura: '+n.toLocaleString('es-ES')+' fichas verificadas…')});
   // A known, nonempty cloud catalog must never be shown as blank on failure.
   const remembered=Number(localStorage.getItem('mc-catalog-cloud-seen-'+uid)||0);
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
 root.MCCatalogBootstrap={bootstrap,scanCloud,restoreAtomically,verifiedSnapshot};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.MCCatalogBootstrap;
})(typeof window!=='undefined'?window:globalThis);
