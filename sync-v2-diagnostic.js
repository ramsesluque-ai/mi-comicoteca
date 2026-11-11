'use strict';
/* Read-only diagnostic: only enabled with ?syncv2=diagnostico for the owner.
   No putStore, delStore, PATCH, POST, or DELETE operations. */
(async function(){
 const p=new URLSearchParams(location.search);
 if(p.get('syncv2')!=='diagnostico')return;
 const session=JSON.parse(sessionStorage.getItem('mc_supabase_session_v1')||'null');
 if(session?.user?.id!=='d16a7b7d-57de-4c4f-900c-0b39fe1abbb1'){console.warn('Diagnóstico V2: cuenta no autorizada');return}
 const cfg=window.MI_COMICOTECA_CLOUD;
 if(!cfg?.url||!session.access_token||!window.MCReconcileV2){console.warn('Diagnóstico V2: sesión o motor no disponible');return}
 const result={local:0,cloud:0,conflicts:0,downloads:0,updates:0,errors:[]};
 try{
  const local=await allStore('comics');result.local=local.length;
  const remote=[];
  for(let offset=0;;offset+=500){
   const url=cfg.url+'/rest/v1/user_comics?select=user_id,metadata&user_id=eq.'+encodeURIComponent(session.user.id)+'&limit=500&offset='+offset;
   const response=await fetch(url,{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token},cache:'no-store'});
   if(!response.ok)throw Error('Cloud HTTP '+response.status);
   const rows=await response.json();
   remote.push(...rows.filter(x=>x.user_id===session.user.id&&x.metadata?.kind==='comics'&&!x.metadata?.deleted&&x.metadata?.record).map(x=>x.metadata.record));
   if(rows.length<500)break;
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
 }catch(e){result.errors.push(String(e));console.error('Diagnóstico V2',e)}
})();
