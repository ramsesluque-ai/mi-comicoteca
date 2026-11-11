'use strict';
/* Moderación de portadas: exclusiva de la cuenta propietaria, validada también mediante RLS */
(function(){
const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1';
const cfg=()=>window.MI_COMICOTECA_CLOUD||{};
const sess=()=>{try{return JSON.parse(sessionStorage.getItem('mc_supabase_session_v1')||localStorage.getItem('mc_supabase_session_v1')||'null')}catch{return null}};
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function headers(json=false){const c=cfg(),s=sess();if(!s?.access_token)throw Error('Inicia sesión.');return {apikey:c.publishableKey,Authorization:'Bearer '+s.access_token,...(json?{'Content-Type':'application/json'}:{})}}
async function request(path,init={}){const r=await fetch(cfg().url+path,init);if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.message||j.error||('HTTP '+r.status))}if(r.status===204)return null;return r.json().catch(()=>null)}
async function currentUser(){if(!sess()?.access_token)return null;try{return await request('/auth/v1/user',{headers:headers()})}catch{return null}}
function setNav(user){
 const nav=document.querySelector('.side .nav');if(!nav)return;
 let button=nav.querySelector('#mcAdminCovers');
 if(user?.id!==OWNER){button?.remove();return}
 if(!button){button=document.createElement('button');button.id='mcAdminCovers';button.type='button';button.textContent='Administración · Portadas';button.onclick=()=>window.mcOpenCoverAdmin();nav.appendChild(button)}
}
let visible=false;
async function open(){
 const u=await currentUser();if(u?.id!==OWNER){setNav(null);return}
 const modal=document.getElementById('modal');if(!modal)return;
 modal.innerHTML='<div class="modalbox mc-cover-admin"><div class="modalhead"><div><b>Administración · Portadas pendientes</b><div class="muted small">Revisión de aportaciones al Maestro compartido</div></div><button class="btn" id="mcAdminClose">Cerrar</button></div><div class="modalbody"><div class="mc-admin-notice">Las imágenes de terceros no se pueden publicar por el mero hecho de aparecer en Tebeosfera. Verifica una autorización o licencia que permita su difusión pública antes de aprobar.</div><div id="mcAdminList">Cargando propuestas…</div></div></div>';
 modal.classList.remove('hidden');visible=true;
 document.getElementById('mcAdminClose').onclick=()=>{visible=false;window.closeModal?.()};
 await load();
}
const labelRights={own_work:'Obra propia',licensed:'Licencia acreditada',public_domain:'Dominio público declarado'};
async function load(){
 const box=document.getElementById('mcAdminList');if(!box)return;
 try{
 const rows=await request('/rest/v1/master_cover_proposals?select=id,title,isbn,identity_key,bibliographic_identity,original_filename,private_path,rights_basis,rights_note,created_at,status&status=eq.pending&order=created_at.asc&limit=100',{headers:headers()});
 if(!rows?.length){box.innerHTML='<div class="mc-admin-empty">No hay propuestas pendientes de revisión.</div>';return}
 box.innerHTML=rows.map((r,i)=>{
 const b=r.bibliographic_identity||{};
 const info=[b.publisher,b.series,b.volume?'Vol. '+b.volume:'',b.issueNr?'Nº '+b.issueNr:''].filter(Boolean).join(' · ');
 const warning=/tebeosfera/i.test(r.rights_note||'')?'<div class="mc-admin-warning">Atención: citar Tebeosfera como origen no demuestra que esta imagen sea de dominio público.</div>':'';
 return '<article class="mc-admin-item" data-index="'+i+'"><div class="mc-admin-meta"><strong>'+esc(r.title)+'</strong><small>'+esc(info)+'</small><small>'+esc(r.original_filename)+' · '+esc(labelRights[r.rights_basis]||r.rights_basis)+'</small><small>Justificación aportada: '+esc(r.rights_note)+'</small></div><div class="mc-admin-actions"><button class="btn" data-show="'+i+'">Ver imagen</button></div><div class="mc-admin-review-layout"><div class="mc-admin-preview" id="mcAdminPreview'+i+'">Pulsa «Ver imagen» para previsualizar la portada.</div><div class="mc-admin-review-controls">'+warning+'<label class="mc-admin-reviewlabel">Prueba de derechos / observaciones de revisión<textarea id="mcAdminNote'+i+'" rows="2" placeholder="Anota la licencia concreta o explica por qué se rechaza"></textarea></label><label class="mc-admin-check"><input type="checkbox" id="mcAdminCheck'+i+'"> He comprobado que existe autorización válida para publicar esta portada para todos los usuarios.</label><div class="mc-admin-actions"><button class="btn" data-reject="'+i+'">Rechazar</button><button class="btn primary" data-approve="'+i+'">Aprobar y publicar</button></div><p class="mc-admin-feedback" id="mcAdminFeedback'+i+'" role="status"></p></div></div></article>';
 }).join('');
 box.querySelectorAll('[data-show]').forEach(b=>b.onclick=()=>preview(rows[+b.dataset.show],+b.dataset.show));
 box.querySelectorAll('.mc-admin-item').forEach((item,i)=>{const p=item.querySelector('.mc-admin-preview');if(p)preview(rows[i],i)});
 box.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>review(rows[+b.dataset.reject],+b.dataset.reject,false));
 box.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>review(rows[+b.dataset.approve],+b.dataset.approve,true));
 }catch(e){box.textContent='No se pudo cargar la cola: '+e.message}
}
async function privateBlob(r){
 if(!r.private_path || !/^[a-z0-9-]+\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(r.private_path))throw Error('Ruta privada inesperada');
 const url=cfg().url+'/storage/v1/object/master-contributions/'+r.private_path;
 const response=await fetch(url,{headers:headers()});if(!response.ok)throw Error('No se pudo leer la imagen privada');
 const blob=await response.blob();if(!['image/jpeg','image/png','image/webp'].includes(blob.type)||blob.size>5242880)throw Error('Formato de imagen inválido');return blob
}
async function preview(r,i){
 const el=document.getElementById('mcAdminPreview'+i);if(!el)return;
 el.textContent='Cargando imagen privada…';
 try{const blob=await privateBlob(r),url=URL.createObjectURL(blob);el.innerHTML='';const img=document.createElement('img');img.alt='Portada aportada para revisión';img.src=url;img.onload=()=>URL.revokeObjectURL(url);el.appendChild(img)}catch(e){el.textContent=e.message}
}
async function review(r,i,approve){
 const feedback=document.getElementById('mcAdminFeedback'+i),note=document.getElementById('mcAdminNote'+i)?.value.trim()||'',confirmed=document.getElementById('mcAdminCheck'+i)?.checked;
 if(approve&&(!confirmed||note.length<20)){feedback.textContent=!confirmed?'Marca la casilla de autorización para continuar.':'La casilla está marcada, pero falta describir la prueba de derechos (mínimo 20 caracteres).';document.getElementById('mcAdminNote'+i)?.focus();return}
 if(!approve&&note.length<5){feedback.textContent='Indica el motivo del rechazo.';return}
 if(!window.confirm(approve?'¿Publicar esta portada para todos los usuarios después de comprobar sus derechos?':'¿Rechazar esta aportación?'))return;
 feedback.textContent='Procesando revisión…';
 const card=feedback.closest('.mc-admin-item');card.querySelectorAll('button').forEach(b=>b.disabled=true);
 let publicPath=null,changed=false;
 try{
 const u=await currentUser();if(u?.id!==OWNER)throw Error('No tienes permisos para revisar');
 let url=null;
 if(approve){
 const blob=await privateBlob(r);
 const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
 publicPath=r.id+'.'+ext;
 const put=await fetch(cfg().url+'/storage/v1/object/approved-master-covers/'+publicPath,{method:'POST',headers:{...headers(),'Content-Type':blob.type,'x-upsert':'false'},body:blob});
 if(!put.ok){const j=await put.json().catch(()=>({}));throw Error(j.message||j.error||'Error publicando la imagen')}
 url=cfg().url+'/storage/v1/object/public/approved-master-covers/'+publicPath;
 }
 const payload={status:approve?'approved':'rejected',reviewed_by:u.id,reviewed_at:new Date().toISOString(),review_note:note,rights_verified:!!(approve&&confirmed)};
 const updated=await request('/rest/v1/master_cover_proposals?id=eq.'+encodeURIComponent(r.id)+'&status=eq.pending',{method:'PATCH',headers:{...headers(true),Prefer:'return=representation'},body:JSON.stringify(payload)});
 if(!updated?.length)throw Error('La propuesta ya no está pendiente o la actualización fue denegada');
 changed=true;
 if(approve){
 await request('/rest/v1/master_cover_approved',{method:'POST',headers:{...headers(true),Prefer:'return=representation'},body:JSON.stringify({identity_key:r.identity_key,isbn:r.isbn||null,cover_url:url,proposal_id:r.id})});
 await window.mcSharedCovers?.(true);
 }
 feedback.textContent=approve?'Portada aprobada y publicada en el Maestro compartido.':'Propuesta rechazada.';
 await load();
 }catch(e){
 if(!changed&&publicPath){await fetch(cfg().url+'/storage/v1/object/approved-master-covers/'+publicPath,{method:'DELETE',headers:headers()}).catch(()=>{})}
 feedback.textContent='No se ha completado la revisión: '+e.message+(changed?' La revisión quedó registrada; comprueba la publicación antes de repetir.':'');
 card.querySelectorAll('button').forEach(b=>b.disabled=false);
 }
}
window.mcOpenCoverAdmin=open;
async function init(){const u=await currentUser();setNav(u)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.addEventListener('focus',()=>{if(!visible)init()});
})();
