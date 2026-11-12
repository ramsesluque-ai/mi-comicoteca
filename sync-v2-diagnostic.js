'use strict';
/* Read-only diagnostic: only enabled with ?syncv2=diagnostico for the owner.
   No putStore, delStore, PATCH, POST, or DELETE operations. */
(async function(){
 const p=new URLSearchParams(location.search);
 if(p.get('syncv2')!=='diagnostico')return;
 const session=JSON.parse(sessionStorage.getItem('mc_supabase_session_v1')||'null');
 if(session?.user?.id!=='0bcbe06d-263d-4ac1-a516-355d27d417f1'){console.warn('Diagnóstico V2: cuenta no autorizada');alert('Diagnóstico V2: inicia sesión con la cuenta propietaria.');return}
 const cfg=window.MI_COMICOTECA_CLOUD;
 if(!cfg?.url||!session.access_token||!window.MCReconcileV2){console.warn('Diagnóstico V2: sesión o motor no disponible');alert('Diagnóstico V2: falta la sesión o el motor.');return}
 const result={local:0,cloud:0,conflicts:0,downloads:0,updates:0,errors:[]};
 try{
  if(typeof db==='undefined'||!db){for(let i=0;i<30&&!db;i++)await new Promise(resolve=>setTimeout(resolve,200));if(!db)throw Error('La base local no está disponible') }
  const local=await allStore('comics');result.local=local.length;
  const remote=[];
  const seenKeys=new Set();
  let lastKey=null;
  for(let page=0;page<10000;page++){
   // Keyset pagination: offset pages can skip/repeat rows during concurrent inserts.
   // local_id is unique per user and must be non-null for a safe complete scan.
   const after=lastKey===null?'':'&local_id=gt.'+encodeURIComponent(lastKey);
   const url=cfg.url+'/rest/v1/user_comics?select=user_id,local_id,metadata&user_id=eq.'+encodeURIComponent(session.user.id)+'&order=local_id.asc&limit=500'+after;
   const response=await fetch(url,{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token},cache:'no-store'});
   if(!response.ok)throw Error('Cloud HTTP '+response.status);
   const rows=await response.json();
   for(const row of rows){
    if(row.user_id!==session.user.id)throw Error('Respuesta con usuario distinto');
    if(typeof row.local_id!=='string'||!row.local_id.trim())throw Error('Fila sin local_id estable: diagnóstico incompleto');
    if((lastKey!==null&&row.local_id<=lastKey)||seenKeys.has(row.local_id))throw Error('Paginación inestable o local_id duplicado');
    seenKeys.add(row.local_id);
    lastKey=row.local_id;
    if(row.metadata?.kind==='comics'&&!row.metadata?.deleted&&row.metadata?.record)remote.push(row.metadata.record);
   }
   if(rows.length<500)break;
   if(page===9999)throw Error('Límite de páginas alcanzado: diagnóstico incompleto');
  }
  result.cloud=remote.length;
  const analysis=MCReconcileV2.reconcile(local,remote);
  result.conflicts=analysis.conflicts.length;result.downloads=analysis.downloads.length;result.updates=analysis.updates.length;
  window.MC_SYNC_V2_DIAGNOSTIC=result;
  console.info('MI COMICTECA V2 diagnóstico SOLO LECTURA',result);
  const el=document.createElement('div');el.setAttribute('role','status');
  el.style.cssText='position:fixed;bottom:12px;right:12px;z-index:999999;background:#10253b;color:white;padding:14px;border-radius:10px;font:14px system-ui;max-width:340px;box-shadow:0 2px 12px #0006';
  el.textContent='Diagnóstico V2 (solo lectura): '+result.local+' locales, '+result.cloud+' nube, '+result.conflicts+' conflictos, '+result.downloads+' descargas propuestas, '+result.updates+' actualizaciones propuestas. No se ha modificado ninguna ficha.';
  document.body.appendChild(el);
 }catch(e){result.errors.push(String(e));console.error('Diagnóstico V2',e);alert('Diagnóstico V2: '+String(e).slice(0,180))}
})();
