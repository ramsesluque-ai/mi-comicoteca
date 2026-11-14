'use strict';
/* Manual sync V2 entry point. Fail closed until bidirectional E2E and RLS are verified.
   No database or network writes are performed by this module. */
(function(){
 const ID='mc-manual-sync-v2';
 const text='Sincronizar ahora';
 function findNewComic(){
   const root=document.querySelector('#view');
   if(!root)return null;
   return [...root.querySelectorAll('button,a')].find(el=>/^(\+\s*)?(nuevo|añadir)\s+c[oó]mic$/i.test((el.textContent||'').trim()))||null;
 }
 function showStatus(){
   const existing=document.getElementById('mc-manual-sync-status');
   if(existing){existing.focus();return}
   const panel=document.createElement('div');
   panel.id='mc-manual-sync-status';
   panel.setAttribute('role','alertdialog');
   panel.setAttribute('aria-modal','true');
   panel.setAttribute('aria-label','Estado de sincronización');
   panel.style.cssText='position:fixed;z-index:2147483640;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 32px));max-height:85dvh;overflow-y:auto;padding:22px;background:#10253b;color:#fff;border:1px solid #63819b;border-radius:14px;box-shadow:0 8px 50px #000b;font:15px/1.5 system-ui';
   const title=document.createElement('strong');title.textContent='Sincronización manual — pendiente de validación';
   const p=document.createElement('p');p.textContent='La sincronización bidireccional todavía no ha superado las pruebas entre dos dispositivos y de aislamiento por usuario. Por seguridad, no se enviará, modificará ni borrará ningún cómic. Tus datos locales permanecen intactos.';
   const diagnostic=document.createElement('p');diagnostic.setAttribute('role','status');diagnostic.textContent='Comprobando disponibilidad local (solo lectura)…';
   (async()=>{try{
     const raw=sessionStorage.getItem('mc_supabase_session_v1')||localStorage.getItem('mc_supabase_session_v1');
     const session=raw?JSON.parse(raw):null;
     const authenticated=Boolean(session?.user?.id&&session?.access_token);
     const rows=typeof allStore==='function'?await allStore('comics'):null;
     if(!panel.isConnected)return;
     diagnostic.textContent=(authenticated?'Sesión identificada. ':'Inicia sesión para sincronizar. ')+(Array.isArray(rows)?rows.length.toLocaleString('es-ES')+' fichas locales detectadas. ':'No se pudo verificar la colección local. ')+'No se ha realizado ninguna escritura ni descarga.';
     if(authenticated&&Array.isArray(rows)){
       const cfg=window.MI_COMICOTECA_CLOUD||{};
       if(!cfg.url||!cfg.publishableKey)throw Error('Configuración cloud no disponible');
       if(!window.MCSyncV2ReadPlan?.compare)throw Error('Motor de comparación V2 no disponible');
       const result=await window.MCSyncV2ReadPlan.compare({
         session,cfg,localRows:rows,
         onProgress:x=>{
           if(!panel.isConnected)return;
           diagnostic.textContent='Comparación SOLO LECTURA: '+x.local.toLocaleString('es-ES')+' fichas locales; '+x.scanned.toLocaleString('es-ES')+' filas cloud examinadas en '+x.pages+' páginas. No se han realizado escrituras.';
         }
       });
       if(!panel.isConnected)return;
       diagnostic.textContent='Comparación completada y cuenta verificada. Local: '+result.local.toLocaleString('es-ES')+
         '; nube: '+result.cloud.toLocaleString('es-ES')+
         '; idénticas: '+result.equal.toLocaleString('es-ES')+
         '; diferentes (requieren resolver conflictos): '+result.different.toLocaleString('es-ES')+
         '; solo locales: '+result.onlyLocal.toLocaleString('es-ES')+
         '; solo en nube: '+result.onlyCloud.toLocaleString('es-ES')+
         '; eliminaciones explícitas: '+result.tombstones.toLocaleString('es-ES')+
         '. No se ha sobrescrito, descargado, subido ni borrado ningún cómic. La sincronización real sigue bloqueada hasta validar el respaldo, la reconciliación y las pruebas en dos sesiones.';
     }
   }catch(e){if(panel.isConnected)diagnostic.textContent='Diagnóstico local no disponible: '+String(e.message||e)+'. Ningún dato modificado.'}})();
   // Portadas pertenecen a CacheStorage + Storage, no al JSON bibliográfico.
   // Compare only, never assume a matching filename proves image integrity.
   const covers=document.createElement('p');
   covers.setAttribute('role','status');
   covers.textContent='Inventario de portadas: pendiente de comprobar.';
   (async()=>{try{
     const raw=sessionStorage.getItem('mc_supabase_session_v1')||localStorage.getItem('mc_supabase_session_v1');
     const session=raw?JSON.parse(raw):null,cfg=window.MI_COMICOTECA_CLOUD||{};
     if(!session?.access_token||!session?.user?.id)return;
     if(!window.MCSyncV2CoverInventory?.compare)throw Error('Módulo de portadas no disponible');
     const summary=await MCSyncV2CoverInventory.compare({session,cfg});
     if(panel.isConnected)covers.textContent='Portadas privadas (solo lectura): '+summary.local+' archivos locales; '+summary.remote+' en Supabase; '+summary.matched+' coinciden por nombre; '+summary.onlyLocal+' solo locales; '+summary.onlyRemote+' solo en nube. Falta verificar SHA-256 binario. Ninguna imagen modificada.';
   }catch(e){if(panel.isConnected)covers.textContent='Portadas: no se pudo completar la comprobación ('+String(e.message||e)+'). Sin escrituras.'}})();
   // Explicit SHA-256 check; never upload, install or overwrite a cover.
   const coverAudit=document.createElement('button');
   coverAudit.type='button';
   coverAudit.textContent='Comprobar integridad de portadas (SHA-256)';
   coverAudit.style.cssText='padding:9px 12px;margin:6px 8px 10px 0;border-radius:8px;cursor:pointer;background:#27465c;color:white;border:1px solid #73b9d1';
   coverAudit.onclick=async()=>{
     coverAudit.disabled=true;
     try{
       const raw=sessionStorage.getItem('mc_supabase_session_v1')||localStorage.getItem('mc_supabase_session_v1');
       const session=raw?JSON.parse(raw):null,cfg=window.MI_COMICOTECA_CLOUD||{};
       if(!window.MCSyncV2CoverInventory?.compareBytes)throw Error('Comprobación binaria no disponible');
       covers.textContent='Comparando bytes de portadas privadas (solo lectura)…';
       const result=await window.MCSyncV2CoverInventory.compareBytes({
         session,cfg,maxCheck:30,
         onProgress:x=>{if(panel.isConnected)covers.textContent='SHA-256: '+x.checked+' / '+x.totalMatched+' portadas comprobadas; '+x.identical+' idénticas, '+x.different+' diferentes. Ningún dato modificado.';}
       });
       if(panel.isConnected)covers.textContent=result.checked===0?'Integridad privada NO VALIDADA: no hay portadas emparejadas verificadas byte a byte (0 comprobaciones). Las portadas locales y remotas pueden existir sin coincidir por clave. No se ha modificado ninguna imagen; la sincronización sigue bloqueada.':'Integridad privada: '+result.checked+' portadas verificadas byte a byte; '+result.identical+' idénticas, '+result.different+' diferentes; '+result.remaining+' sin comprobar'+(result.complete?' (comprobación completa).':' (límite de 30 por comprobación).')+' Sin escrituras. La coincidencia no habilita todavía la sincronización.';
     }catch(e){if(panel.isConnected)covers.textContent='No se pudo verificar la integridad: '+String(e.message||e)+'. No se ha modificado ninguna portada.'}
     finally{coverAudit.disabled=false}
   };
   const backup=document.createElement('button');backup.type='button';backup.textContent='Respaldar fichas locales (JSON + SHA-256; sin portadas)';backup.style.cssText='padding:9px 12px;margin:10px 8px 0 0;border-radius:8px;cursor:pointer;background:#16678a;color:white;border:1px solid #73b9d1';
   backup.onclick=async()=>{backup.disabled=true;backup.textContent='Preparando respaldo…';try{
     if(typeof allStore!=='function')throw Error('Almacén local no disponible');
     const comics=await allStore('comics');if(!Array.isArray(comics))throw Error('Lectura local incompleta');
     const ids=new Set();for(const c of comics){const id=String(c.id||'');if(!id||ids.has(id))throw Error('ID local ausente o duplicado; respaldo cancelado');ids.add(id)}
     const payload=JSON.stringify({format:'mi-comicoteca-local-backup-v1',exportedAt:new Date().toISOString(),count:comics.length,comics});
     if(!window.crypto?.subtle)throw Error('SHA-256 no disponible en este navegador');
     const bytes=new TextEncoder().encode(payload),digest=await crypto.subtle.digest('SHA-256',bytes);
     const sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
     const name='mi-comicoteca-respaldo-'+new Date().toISOString().replace(/[:.]/g,'-');
     function download(data,filename,type){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
     download(payload,name+'.json','application/json');download(sha+'  '+name+'.json\n',name+'.sha256','text/plain');
     diagnostic.textContent='Respaldo preparado: '+comics.length.toLocaleString('es-ES')+' fichas, '+bytes.length.toLocaleString('es-ES')+' bytes, SHA-256 '+sha+'. ATENCIÓN: este respaldo contiene fichas, NO los bytes de las portadas de CacheStorage. Conserva ambos archivos; no se han modificado datos.';
     backup.textContent='Descargar respaldo de nuevo';
   }catch(e){diagnostic.textContent='No se pudo preparar respaldo: '+String(e.message||e)+'. Ningún dato modificado.';backup.textContent='Reintentar respaldo'}finally{backup.disabled=false}};
   const verifyBox=document.createElement('div');
   verifyBox.style.cssText='margin:12px 0;padding:10px;border:1px solid #63819b;border-radius:8px';
   const verifyTitle=document.createElement('div');verifyTitle.textContent='Verificar los archivos descargados (solo lectura)';
   const jsonInput=document.createElement('input');jsonInput.type='file';jsonInput.accept='.json';jsonInput.setAttribute('aria-label','Respaldo JSON');
   const shaInput=document.createElement('input');shaInput.type='file';shaInput.accept='.sha256';shaInput.setAttribute('aria-label','Manifiesto SHA-256');
   for(const input of [jsonInput,shaInput])input.style.cssText='display:block;max-width:100%;margin:8px 0';
   const verifyBtn=document.createElement('button');verifyBtn.type='button';verifyBtn.textContent='Comprobar respaldo';
   verifyBtn.onclick=async()=>{verifyBtn.disabled=true;try{
     const json=jsonInput.files?.[0],manifest=shaInput.files?.[0];
     if(!json||!manifest||!json.name.endsWith('.json')||manifest.name!==json.name.replace(/\.json$/,'.sha256'))throw Error('Selecciona el JSON y su archivo .sha256 correspondiente');
     const line=(await manifest.text()).trim().match(/^([a-f0-9]{64})\s+(.+\.json)$/i);
     if(!line||line[2]!==json.name)throw Error('El manifiesto no corresponde al JSON');
     if(!crypto?.subtle)throw Error('SHA-256 no disponible');
     const bytes=await json.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
     const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
     if(actual.toLowerCase()!==line[1].toLowerCase())throw Error('SHA-256 incorrecto: respaldo alterado');
     const parsed=JSON.parse(new TextDecoder().decode(bytes));
     if(parsed?.format!=='mi-comicoteca-local-backup-v1'||!Array.isArray(parsed.comics)||parsed.count!==parsed.comics.length)throw Error('Estructura o recuento inválidos');
     const ids=new Set();for(const c of parsed.comics){const id=String(c?.id??'');if(!id||ids.has(id))throw Error('ID vacío o duplicado en el respaldo');ids.add(id)}
     diagnostic.textContent='Respaldo verificado: '+ids.size.toLocaleString('es-ES')+' fichas, SHA-256 '+actual+'. Solo fichas: NO incluye imágenes de portadas. No se ha restaurado ni modificado ningún dato. Sincronización real bloqueada hasta pruebas E2E.';
   }catch(e){diagnostic.textContent='Respaldo NO verificado: '+String(e.message||e)+'. No se ha modificado ningún dato.'}finally{verifyBtn.disabled=false}};
   verifyBox.append(verifyTitle,jsonInput,shaInput,verifyBtn);
   const close=document.createElement('button');close.type='button';close.textContent='Entendido';close.style.cssText='padding:9px 16px;border-radius:8px;cursor:pointer';close.onclick=()=>panel.remove();
   panel.append(title,p,diagnostic,covers,coverAudit,backup,verifyBox,close);document.body.append(panel);close.focus();
 }
 function mount(){
   const anchor=findNewComic();
   if(!anchor)return;
   let btn=document.getElementById(ID);
   if(!btn){
     btn=document.createElement('button');btn.id=ID;btn.type='button';btn.textContent='↻ '+text;
     btn.title='Sincronización manual V2: pendiente de pruebas de seguridad';
     btn.style.cssText='display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;min-height:38px;padding:8px 12px;margin-left:8px;max-width:100%;flex-shrink:0;border-radius:9px;border:1px solid #4eacc7;background:#123e56;color:#fff;font:600 13px system-ui;cursor:pointer';
     btn.addEventListener('click',showStatus);
   }
   if(anchor.nextElementSibling!==btn)anchor.insertAdjacentElement('afterend',btn);
   const parent=anchor.parentElement;
   if(parent){parent.style.flexWrap='wrap';parent.style.rowGap='8px';btn.style.marginLeft='0';}
 }
 let pending=false;
 const observer=new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;mount()})});
 function init(){observer.observe(document.querySelector('#view')||document.body,{childList:true,subtree:true});mount()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();