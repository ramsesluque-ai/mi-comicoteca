'use strict';
/* Explicit owner-only mobile restore from immutable initial cloud upload.
 * Creates downloadable JSON backup before offering destructive local replacement.
 * No remote writes. Never touches other accounts.
 */
(async function(){
 if(new URLSearchParams(location.search).get('syncv2')!=='restaurar')return;
 const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1';
 const s=JSON.parse(sessionStorage.getItem('mc_supabase_session_v1')||'null');
 if(s?.user?.id!==OWNER){alert('Inicia sesión con tu cuenta propietaria.');return}
 const cfg=window.MI_COMICOTECA_CLOUD;
 if(!cfg?.url||!s.access_token){alert('Sesión cloud no disponible.');return}
 for(let i=0;i<50&&(typeof db==='undefined'||!db);i++)await new Promise(r=>setTimeout(r,200));
 if(typeof db==='undefined'||!db){alert('Base local no disponible.');return}
 const box=document.createElement('aside');box.style.cssText='position:fixed;right:8px;left:8px;bottom:8px;z-index:999999;max-width:520px;margin-left:auto;background:#10253b;color:white;border-radius:12px;padding:16px;font:14px system-ui;max-height:85vh;overflow:auto';
 box.innerHTML='<strong>Restauración privada desde el ordenador</strong><p id="v2restoreStatus">Preparando copia de la nube…</p><button id="v2restoreBackup" disabled>1. Descargar respaldo del móvil</button> <button id="v2restoreApply" disabled>2. Restaurar las 16.523 fichas</button>';
 document.body.appendChild(box);const status=box.querySelector('#v2restoreStatus'),backup=box.querySelector('#v2restoreBackup'),apply=box.querySelector('#v2restoreApply');
 try{
  const local=await allStore('comics'),cloud=[];
  for(let offset=0;;offset+=250){
   const url=cfg.url+'/rest/v1/user_comics?select=metadata,user_id&user_id=eq.'+OWNER+'&limit=250&offset='+offset+'&order=created_at.asc';
   const response=await fetch(url,{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+s.access_token},cache:'no-store'});
   if(!response.ok)throw Error('Supabase HTTP '+response.status);
   const rows=await response.json();
   for(const x of rows){const m=x.metadata,r=m?.record;if(x.user_id===OWNER&&m?.kind==='comics'&&m?.source==='owner-local-initial'&&!m.deleted&&r?.id)cloud.push(r)}
   status.textContent='Verificando nube: '+cloud.length+' fichas…';
   if(rows.length<250)break;
  }
  const cloudIds=new Set(cloud.map(r=>String(r.id)));
  if(cloud.length!==16523||cloudIds.size!==16523)throw Error('La nube no coincide con la copia esperada: '+cloud.length+' fichas, '+cloudIds.size+' IDs únicos. Operación bloqueada.');
  const localIds=new Set(local.map(r=>String(r.id)));
  const missing=cloud.filter(r=>!localIds.has(String(r.id))).length;
  const extras=local.filter(r=>!cloudIds.has(String(r.id))).length;
  status.textContent='Copia original verificada: 16.523 fichas. Móvil: '+local.length+'. Faltan '+missing+' identificadores originales y sobran '+extras+' locales. Descarga primero el respaldo.';
  let backedUp=false;
  backup.disabled=false;
  backup.onclick=()=>{
   const payload={type:'mi-comicteca-local-backup-before-v2-restore',createdAt:new Date().toISOString(),database:DBN,records:local};
   const blob=new Blob([JSON.stringify(payload)],{type:'application/json'}),url=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=url;a.download='mi-comicteca-respaldo-movil-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   backedUp=true;apply.disabled=false;status.textContent='Descarga solicitada. Comprueba en Descargas que el archivo JSON existe antes de restaurar.';
  };
  apply.onclick=async()=>{
   if(!backedUp){alert('Primero descarga el respaldo.');return}
   if(!confirm('ATENCIÓN: se sustituirán las fichas locales de ESTE dispositivo por las 16.523 originales de Supabase. Se perderán cambios exclusivos del móvil. ¿Confirmas?'))return;
   apply.disabled=true;backup.disabled=true;
   try{
    // Atomic replacement in one IndexedDB transaction: no intermediate partial catalog.
    await new Promise((resolve,reject)=>{
     const tx=db.transaction('comics','readwrite'),store=tx.objectStore('comics');
     store.clear();for(const r of cloud)store.put(r);
     tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('Transacción fallida'));tx.onabort=()=>reject(tx.error||Error('Transacción cancelada'));
    });
    const after=await allStore('comics');
    const afterIds=new Set(after.map(r=>String(r.id)));
    if(after.length!==16523||afterIds.size!==16523||cloud.some(r=>!afterIds.has(String(r.id))))throw Error('La verificación posterior no coincide. Conserva el respaldo y no realices más cambios.');
    status.textContent='Restauración local verificada: 16.523 fichas, 16.523 identificadores iguales a Supabase. Recarga la página para actualizar el catálogo. Sincronización automática sigue desactivada.';
   }catch(e){status.textContent='ERROR de restauración: '+String(e)+'. Conserva el respaldo.';console.error(e)}
  };
 }catch(e){status.textContent='Restauración bloqueada: '+String(e);console.error(e)}
})();
