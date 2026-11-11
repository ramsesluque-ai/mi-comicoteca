'use strict';
/* Owner-only V2 download test. Explicit opt-in. Never delete local data or
 overwrite a populated field. Duplicate edition/issue IDs are skipped. */
(async function(){
 if(new URLSearchParams(location.search).get('syncv2')!=='recepcion')return;
 const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1';
 const s=JSON.parse(sessionStorage.getItem('mc_supabase_session_v1')||'null');
 if(s?.user?.id!==OWNER){alert('Inicia sesión con tu cuenta para la prueba de recepción.');return}
 const cfg=window.MI_COMICOTECA_CLOUD;
 if(!cfg?.url||!s.access_token){alert('Falta la sesión cloud.');return}
 for(let i=0;i<50&&(typeof db==='undefined'||!db);i++)await new Promise(r=>setTimeout(r,200));
 if(typeof db==='undefined'||!db){alert('No se encontró la base local.');return}
 const el=document.createElement('aside');el.style.cssText='position:fixed;right:12px;bottom:12px;z-index:999999;background:#10253b;color:white;padding:16px;border-radius:12px;max-width:370px;font:14px system-ui';
 el.innerHTML='<strong>Recepción V2 — prueba privada</strong><p id="v2recv">No se descargará nada sin tu confirmación.</p><button id="v2receive">Recibir catálogo de la nube</button>';document.body.appendChild(el);
 const status=el.querySelector('#v2recv'),button=el.querySelector('#v2receive');
 button.onclick=async()=>{
  if(!confirm('Se añadirán las fichas que falten en ESTE dispositivo. No se eliminarán ni sobrescribirán las existentes. ¿Continuar?'))return;
  button.disabled=true;let added=0,skipped=0;
  try{
   const local=await allStore('comics'),ids=new Set(local.map(x=>String(x.id))),identity=window.MCReconcileV2.identity;
   const editions=new Set(local.map(identity).filter(Boolean));
   for(let offset=0;;offset+=250){
    const url=cfg.url+'/rest/v1/user_comics?select=metadata,user_id&user_id=eq.'+OWNER+'&limit=250&offset='+offset+'&order=created_at.asc';
    const resp=await fetch(url,{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+s.access_token},cache:'no-store'});
    if(!resp.ok)throw Error('HTTP '+resp.status);
    const rows=await resp.json();
    for(const row of rows){
     const m=row.metadata,r=m?.record;
     if(row.user_id!==OWNER||m?.kind!=='comics'||m.deleted||!r?.id)continue;
     const key=identity(r);
     if(ids.has(String(r.id))||(key&&editions.has(key))){skipped++;continue}
     await putStore('comics',r);ids.add(String(r.id));if(key)editions.add(key);added++;
    }
    status.textContent='Recibidas '+added+' fichas nuevas; '+skipped+' ya existentes. No cierres la pestaña.';
    if(rows.length<250)break;
   }
   status.textContent='Recepción completada: '+added+' añadidas, '+skipped+' omitidas por existir. Ninguna ficha existente sobrescrita. Recarga la página para visualizar.';
  }catch(e){status.textContent='Recepción interrumpida: '+String(e)+'. Añadidas '+added+'. Puedes reintentar sin duplicar.';button.disabled=false}
 };
})();
