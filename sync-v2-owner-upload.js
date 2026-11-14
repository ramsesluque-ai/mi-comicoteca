'use strict';
/* Owner-only explicit initial migration. Not automatic. Local IndexedDB is authoritative.
   No cloud deletes; no local writes. Does not migrate binary cover assets. */
(async function(){
 // Hard safety gate: legacy owner-only migration routes are not the validated Sync V2 flow.
 // Never enable without authenticated two-session E2E, RLS and binary-cover validation.
 const SYNC_V2_OWNER_WRITE_E2E_APPROVED=false;
 if(!SYNC_V2_OWNER_WRITE_E2E_APPROVED){console.info('MI COMICTECA Sync V2: legacy owner write route disabled pending E2E');return;}
 if(new URLSearchParams(location.search).get('syncv2')!=='subida')return;
 const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1';
 const session=JSON.parse(sessionStorage.getItem('mc_supabase_session_v1')||'null');
 if(session?.user?.id!==OWNER){alert('Esta operación está reservada a la cuenta propietaria.');return}
 const cfg=window.MI_COMICOTECA_CLOUD;
 if(!cfg?.url||!cfg.publishableKey||!session.access_token){alert('Falta la sesión de Supabase.');return}
 for(let i=0;i<50&&(typeof db==='undefined'||!db);i++)await new Promise(r=>setTimeout(r,200));
 if(typeof db==='undefined'||!db){alert('No se pudo abrir la base local.');return}
 const local=await allStore('comics');
 const wrap=document.createElement('aside');wrap.style.cssText='position:fixed;right:12px;bottom:12px;z-index:999999;background:#10253b;color:#fff;padding:18px;max-width:390px;border-radius:12px;font:14px system-ui;box-shadow:0 4px 24px #0008';
 wrap.innerHTML='<strong>Migración privada V2</strong><p id="v2status">Base local: '+local.length+' fichas. La nube se actualizará desde este ordenador, sin borrar fichas locales ni registros remotos ajenos.</p><button id="v2start" style="padding:9px 13px;cursor:pointer">Subir catálogo a Supabase</button><button id="v2stop" style="padding:9px 13px;margin-left:8px;cursor:pointer" disabled>Detener</button>';
 document.body.appendChild(wrap);
 const status=wrap.querySelector('#v2status'),start=wrap.querySelector('#v2start'),stop=wrap.querySelector('#v2stop');
 let cancel=false;
 const headers=()=>({apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'});
 async function api(path,opts={}){const r=await fetch(cfg.url+'/rest/v1/'+path,{...opts,headers:{...headers(),...(opts.headers||{})},cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status+': '+(await r.text()).slice(0,160));return r.json()}
 stop.onclick=()=>{cancel=true;stop.disabled=true;status.textContent='Deteniendo al finalizar el lote actual…'};
 start.onclick=async()=>{
  if(!confirm('¿Confirmas que las '+local.length+' fichas de ESTE ordenador son la referencia para actualizar tu cuenta en Supabase? No se eliminarán fichas. Conserva tu JSON de respaldo.'))return;
  start.disabled=true;stop.disabled=false;cancel=false;
  let uploaded=0,verified=0;
  try{
   // Do not use issue identity for destructive merges. Upsert by stable local ID only.
   for(let offset=0;offset<local.length;offset+=75){
    if(cancel)break;
    const rows=local.slice(offset,offset+75).filter(x=>x&&x.id).map(r=>({user_id:OWNER,local_id:'comics:'+String(r.id),status:r.status==='In Collection'?'owned':r.status==='On Wish List'?'wishlist':'pending',custom_title:String(r.title||r.catalogHeader||r.series||'').slice(0,500),metadata:{comicteca_sync_v:2,kind:'comics',record:r,source:'owner-local-initial',uploaded_at:new Date().toISOString()}}));
    const response=await api('user_comics?on_conflict=user_id,local_id',{method:'POST',body:JSON.stringify(rows)});
    const returned=new Set(response.map(x=>x.local_id));
    if(rows.some(x=>!returned.has(x.local_id)))throw Error('No se confirmaron todos los registros del lote');
    uploaded+=rows.length;verified+=response.length;
    status.textContent='Subidos y confirmados '+verified+' / '+local.length+'. No cierres esta pestaña.';
   }
   if(cancel){status.textContent='Pausada. Confirmados '+verified+' de '+local.length+'. Puedes reanudar sin crear duplicados.';start.disabled=false;return}
   const count=await fetch(cfg.url+'/rest/v1/user_comics?select=id&user_id=eq.'+OWNER+'&metadata->>kind=eq.comics&limit=1',{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token,Prefer:'count=exact'},cache:'no-store'});
   if(!count.ok)throw Error('No se pudo verificar el total remoto');
   const total=count.headers.get('content-range')||'sin total';
   status.textContent='Subida finalizada: '+verified+' fichas confirmadas. Total remoto: '+total+'. Portadas binarias pendientes de comprobación. Sincronización automática aún desactivada.';
   stop.disabled=true;
  }catch(e){status.textContent='Subida detenida tras '+verified+' confirmaciones: '+String(e)+'. No se han borrado datos. Puedes reanudar.';start.disabled=false;stop.disabled=true;console.error('MI COMICTECA V2 upload',e)}
 };
})();
