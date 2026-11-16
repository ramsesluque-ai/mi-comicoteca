'use strict';
/* Emergency owner recovery: cloud READ only, additive local restoration, never remote writes.
   Explicit opt-in ?recuperar=coleccion; does not touch private cover binaries. */
(async function(){
 if(new URLSearchParams(location.search).get('recuperar')!=='coleccion')return;
 const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1',EXPECTED=16523;
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const box=document.createElement('aside');
 box.style.cssText='position:fixed;z-index:2147483640;bottom:12px;right:12px;max-width:480px;width:calc(100vw - 24px);max-height:80vh;overflow:auto;background:#10253b;color:white;padding:18px;border:2px solid #59c7ed;border-radius:12px;font:14px system-ui';
 box.innerHTML='<strong>Recuperación segura de Mi colección</strong><p id="mcRecoveryStatus">Comprobando identidad y catálogo…</p><button id="mcRecoveryBackup" disabled>1. Descargar respaldo verificado de Supabase</button> <button id="mcRecoveryApply" disabled>2. Recuperar fichas en este dispositivo</button>';
 document.body.appendChild(box);
 const status=box.querySelector('#mcRecoveryStatus'),backup=box.querySelector('#mcRecoveryBackup'),apply=box.querySelector('#mcRecoveryApply');
 const fail=e=>{status.textContent='Recuperación detenida sin modificar datos: '+String(e.message||e);console.error('MI COMICTECA recovery',e)};
 try{
  for(let i=0;i<50&&(typeof db==='undefined'||!db);i++)await wait(200);
  if(typeof db==='undefined'||!db)throw Error('IndexedDB no está disponible');
  // Verify and refresh the authenticated identity BEFORE reading the cloud.
  // A stale tab token previously caused an endless HTTP 401 recovery failure.
  const verified=await window.CommercialBilling?.currentUser?.();
  if(verified?.id!==OWNER)throw Error('Inicia sesión con la cuenta propietaria');
  const activeSession=()=>{
   const item=localStorage.getItem('mc_supabase_session_v1')||sessionStorage.getItem('mc_supabase_session_v1');
   const session=JSON.parse(item||'null');
   if(session?.user?.id!==OWNER||!session.access_token)throw Error('Tu sesión ha cambiado. Inicia sesión de nuevo.');
   return session;
  };
  const cfg=window.MI_COMICOTECA_CLOUD;
  if(!cfg?.url||!cfg.publishableKey)throw Error('Configuración Supabase no disponible');
  const cloud=[],seen=new Set();let last=null,complete=false;
  for(let page=0;page<1000;page++){
   const after=last===null?'':'&local_id=gt.'+encodeURIComponent(last);
   const url=cfg.url+'/rest/v1/user_comics?select=user_id,local_id,metadata&user_id=eq.'+encodeURIComponent(OWNER)+'&order=local_id.asc&limit=250'+after;
   const request=()=>fetch(url,{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+activeSession().access_token},cache:'no-store'});
   let resp=await request();
   if(resp.status===401||resp.status===403){
    const refreshed=await window.CommercialBilling?.refreshSession?.();
    if(refreshed?.user?.id!==OWNER)throw Error('Sesión caducada. Inicia sesión de nuevo antes de recuperar tu colección.');
    const reverified=await window.CommercialBilling.currentUser();
    if(reverified?.id!==OWNER)throw Error('Identidad cambiada. Recuperación cancelada.');
    resp=await request();
   }
   if(!resp.ok)throw Error('Supabase HTTP '+resp.status);
   const rows=await resp.json();if(!Array.isArray(rows))throw Error('Respuesta no válida');
   for(const x of rows){
    if(x.user_id!==OWNER||typeof x.local_id!=='string'||!x.local_id||seen.has(x.local_id)||(last!==null&&x.local_id<=last))throw Error('Identidad o paginación remota inválida');
    seen.add(x.local_id);last=x.local_id;
    const m=x.metadata,r=m?.record;
    if(m?.kind==='comics'&&r?.id&&x.local_id!=='comics:'+String(r.id))throw Error('ID inconsistente');
    if(m?.kind==='comics'&&m?.source==='owner-local-initial'&&!m.deleted&&r?.id)cloud.push(r);
   }
   status.textContent='Leyendo y verificando fichas de Supabase: '+cloud.length;
   if(rows.length<250){complete=true;break}
  }
  if(!complete)throw Error('Paginación incompleta');
  const ids=new Set(cloud.map(x=>String(x.id)));
  if(cloud.length!==EXPECTED||ids.size!==EXPECTED)throw Error('Recuento o IDs no coinciden: '+cloud.length);
  const existing=await allStore('comics'),localIds=new Set(existing.map(x=>String(x.id)));
  const missing=cloud.filter(x=>!localIds.has(String(x.id)));
  let downloaded=false; let backupHash='';
  status.textContent='Verificadas '+EXPECTED+' fichas. Locales: '+existing.length+'. Faltantes: '+missing.length+'. Sin escrituras en la nube. Las portadas privadas se revisarán aparte.';
  backup.disabled=false;
  backup.onclick=async()=>{
   const blob=new Blob([JSON.stringify({type:'mi-comicteca-cloud-recovery',createdAt:new Date().toISOString(),owner:OWNER,records:cloud})],{type:'application/json'});
   const bytes=await blob.arrayBuffer();backupHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mi-comicteca-respaldo-nube-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   downloaded=true;apply.disabled=false;
   status.textContent='Respaldo generado. SHA-256: '+backupHash+'. Comprueba que está en Descargas antes de continuar. '+missing.length+' fichas pendientes.';
  };
  apply.onclick=async()=>{
   if(!downloaded||!backupHash||!confirm('Se añadirán únicamente '+missing.length+' fichas que faltan en este dispositivo. No se borrará ni sobrescribirá ninguna ficha local o de Supabase. ¿Continuar?'))return;
   apply.disabled=true;backup.disabled=true;
   try{
    if(missing.length){
     await new Promise((resolve,reject)=>{
      const tx=db.transaction('comics','readwrite'),store=tx.objectStore('comics');
      for(const r of missing)store.add(r);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('Fallo de escritura'));tx.onabort=()=>reject(tx.error||Error('Transacción cancelada'));
     });
    }
    const after=await allStore('comics'),afterIds=new Set(after.map(x=>String(x.id)));
    if(cloud.some(x=>!afterIds.has(String(x.id))))throw Error('Faltan identificadores tras recuperar');
    status.textContent='Recuperación verificada: '+after.length+' fichas locales; los '+EXPECTED+' IDs de Supabase están presentes. Recarga la página para visualizar. Portadas privadas pendientes de verificación independiente.';
   }catch(e){fail(e)}
  };
 }catch(e){fail(e)}
})();
