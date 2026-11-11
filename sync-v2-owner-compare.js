'use strict';
/* Read-only owner reconciliation. No local/cloud mutations. */
(async function(){
 if(new URLSearchParams(location.search).get('syncv2')!=='comparar')return;
 const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1';
 const s=JSON.parse(sessionStorage.getItem('mc_supabase_session_v1')||'null');
 if(s?.user?.id!==OWNER){alert('Inicia sesión con tu cuenta habitual.');return}
 const cfg=window.MI_COMICOTECA_CLOUD;
 if(!cfg?.url||!s.access_token){alert('No está disponible la sesión cloud.');return}
 for(let i=0;i<50&&(typeof db==='undefined'||!db);i++)await new Promise(r=>setTimeout(r,200));
 if(typeof db==='undefined'||!db){alert('Base local no disponible.');return}
 const panel=document.createElement('aside');
 panel.style.cssText='position:fixed;z-index:999999;bottom:8px;right:8px;left:8px;max-width:560px;margin-left:auto;max-height:80vh;overflow:auto;background:#10253b;color:white;padding:16px;border-radius:12px;font:14px system-ui;box-shadow:0 4px 22px #0008';
 panel.innerHTML='<strong>Comparación V2 — solo lectura</strong><p id="v2compareStatus">Preparando comparación…</p><button id="v2compareCopy" disabled style="padding:9px">Copiar informe</button><details><summary>Ver identificadores que faltan</summary><pre id="v2compareIds" style="white-space:pre-wrap;word-break:break-all"></pre></details>';
 document.body.appendChild(panel);
 const status=panel.querySelector('#v2compareStatus'),idsEl=panel.querySelector('#v2compareIds'),copy=panel.querySelector('#v2compareCopy');
 try{
  const local=await allStore('comics'),localIds=new Set(local.map(r=>String(r.id)));
  const cloud=[],cloudIds=new Set();
  for(let offset=0;;offset+=250){
   const url=cfg.url+'/rest/v1/user_comics?select=metadata,user_id&user_id=eq.'+OWNER+'&limit=250&offset='+offset+'&order=created_at.asc';
   const response=await fetch(url,{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+s.access_token},cache:'no-store'});
   if(!response.ok)throw Error('Supabase HTTP '+response.status);
   const rows=await response.json();
   for(const x of rows){const m=x.metadata,r=m?.record;if(x.user_id===OWNER&&m?.kind==='comics'&&m?.source==='owner-local-initial'&&!m.deleted&&r?.id){cloud.push(r);cloudIds.add(String(r.id))}}
   status.textContent='Consultadas '+(offset+rows.length)+' filas de la nube…';
   if(rows.length<250)break;
  }
  const missing=cloud.filter(r=>!localIds.has(String(r.id)));
  const extra=local.filter(r=>!cloudIds.has(String(r.id)));
  const ident=window.MCReconcileV2?.identity;
  const localKeys=new Set(typeof ident==='function'?local.map(ident).filter(Boolean):[]);
  const matched=missing.filter(r=>typeof ident==='function'&&ident(r)&&localKeys.has(ident(r)));
  const localByKey=new Map();if(typeof ident==='function')for(const r of local){const k=ident(r);if(k){const a=localByKey.get(k)||[];a.push(r);localByKey.set(k,a)}}
  const brief=r=>({id:String(r.id),publisher:r.publisher||'',series:r.catalogHeader||r.series||'',volume:r.volume||'',stage:r.stage||'',startYear:r.startYear||'',issue:r.issueNr??r.issue??'',title:r.title||''});
  const pairs=missing.map(r=>({cloud:brief(r),mobileMatches:(localByKey.get(typeof ident==='function'?ident(r):'')||[]).map(brief)}));
  const summary={local:local.length,cloud:cloud.length,missing:missing.length,extra:extra.length,matchingEditionDifferentId:matched.length,missingIds:missing.map(r=>String(r.id)),possiblePairs:pairs,onlyMobile:extra.map(brief)};
  status.textContent='Locales: '+summary.local+' | Nube: '+summary.cloud+' | Faltan en este dispositivo: '+summary.missing+' | Solo en este dispositivo: '+summary.extra+' | Posibles coincidencias de edición con distinto ID: '+summary.matchingEditionDifferentId+'. No se ha modificado ninguna ficha.';
  idsEl.textContent=JSON.stringify({possiblePairs:summary.possiblePairs,onlyMobile:summary.onlyMobile},null,2);
  const report='MI COMICTECA — Comparación V2 (solo lectura)\\n'+JSON.stringify(summary,null,2);
  copy.disabled=false;copy.onclick=async()=>{try{await navigator.clipboard.writeText(report);status.textContent+=' Informe copiado.'}catch(e){const ta=document.createElement('textarea');ta.value=report;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}};
  window.MC_SYNC_V2_COMPARISON=summary;
 }catch(e){status.textContent='Error de comparación: '+String(e);console.error('MI COMICTECA comparación V2',e)}
})();
