'use strict';
(function(){
 const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1',SESSION='mc_supabase_session_v1';
 const cfg=()=>window.MI_COMICOTECA_CLOUD||{};
 const sess=()=>{try{return JSON.parse(localStorage.getItem(SESSION)||sessionStorage.getItem(SESSION)||'null')}catch{return null}};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const date=s=>s?new Date(s).toLocaleString('es-ES'):'—';
 const state=s=>({active:'Activa',trialing:'Prueba gratuita',canceled:'Cancelada',cancelled:'Cancelada',past_due:'Pago pendiente',unpaid:'Impagada',incomplete:'Incompleta',not_subscribed:'Sin suscripción'})[s]||s;
 async function getUsers(){
  const s=sess(),c=cfg();if(!s?.access_token)throw Error('Inicia sesión de nuevo');
  const r=await fetch(c.url+'/functions/v1/admin-users',{headers:{apikey:c.publishableKey,Authorization:'Bearer '+s.access_token},cache:'no-store'});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Error consultando usuarios');return j.users;
 }
 async function open(){
  const modal=document.getElementById('modal');if(!modal)return;
  modal.innerHTML='<div class="modalbox" style="max-width:980px;width:min(96vw,980px);max-height:90vh;overflow:auto"><div class="modalhead"><b>Administración · Usuarios</b><button class="btn" id="mcUsersClose">Cerrar</button></div><div class="modalbody"><p class="muted">Registros de Supabase y estado de suscripción. Los usuarios sin suscripción no aparecerán todavía en Stripe.</p><div id="mcUsersStatus" role="status">Cargando…</div><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;text-align:left"><thead><tr><th>Correo</th><th>Registro</th><th>Último acceso</th><th>Suscripción</th></tr></thead><tbody id="mcUsersRows"></tbody></table></div><button class="btn" id="mcUsersRefresh">Actualizar</button></div></div>';
  modal.classList.remove('hidden');
  document.getElementById('mcUsersClose').onclick=()=>window.closeModal?.();
  document.getElementById('mcUsersRefresh').onclick=load;
  await load();
 }
 async function load(){
  const status=document.getElementById('mcUsersStatus'),body=document.getElementById('mcUsersRows');if(!status||!body)return;
  status.textContent='Consultando usuarios…';
  try{
   const users=await getUsers();if(!document.getElementById('mcUsersRows'))return;
   status.textContent=users.length+' usuarios registrados · '+users.filter(x=>x.subscription_status==='trialing').length+' en prueba · '+users.filter(x=>x.subscription_status==='active').length+' activos';
   body.innerHTML=users.map(x=>'<tr style="border-top:1px solid #31506b"><td style="padding:9px">'+esc(x.email)+'</td><td>'+esc(date(x.registered_at))+'</td><td>'+esc(date(x.last_sign_in_at))+'</td><td>'+esc(state(x.subscription_status))+'</td></tr>').join('')||'<tr><td colspan="4">Sin registros</td></tr>';
  }catch(e){status.textContent='No se pudieron consultar los usuarios: '+String(e.message||e)}
 }
 async function init(){
  const s=sess(),c=cfg();if(!s?.access_token||!c.url)return;
  try{
   const r=await fetch(c.url+'/auth/v1/user',{headers:{apikey:c.publishableKey,Authorization:'Bearer '+s.access_token}});
   if(!r.ok)return;const user=await r.json();if(user.id!==OWNER)return;
   const nav=document.querySelector('.side .nav');if(!nav||nav.querySelector('#mcAdminUsers'))return;
   const btn=document.createElement('button');btn.id='mcAdminUsers';btn.textContent='Administración · Usuarios';btn.onclick=open;nav.appendChild(btn);
  }catch(_){}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();