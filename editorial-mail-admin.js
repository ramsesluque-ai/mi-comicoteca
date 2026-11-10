'use strict';
/* MI COMICTECA — private editorial authorisation requests */
(function(){
 const OWNER="0bcbe06d-263d-4ac1-a516-355d27d417f1",SESSION="mc_supabase_session_v1";
 const cfg=()=>window.MI_COMICOTECA_CLOUD||{};
 const session=()=>{try{return JSON.parse(sessionStorage.getItem(SESSION)||localStorage.getItem(SESSION)||"null")}catch{return null}};
 const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const headers=()=>({apikey:cfg().publishableKey,Authorization:"Bearer "+session()?.access_token});
 let sending=false;
 async function me(){if(!session()?.access_token)return null;try{const r=await fetch(cfg().url+"/auth/v1/user",{headers:headers()});return r.ok?await r.json():null}catch{return null}}
 function add(){const nav=document.querySelector(".side .nav");if(!nav||nav.querySelector("#mcAdminEditorialMail"))return;const b=document.createElement("button");b.id="mcAdminEditorialMail";b.type="button";b.textContent="Administración · Editoriales";b.onclick=()=>window.mcEditorialMail();nav.appendChild(b)}
 async function list(){
 const r=await fetch(cfg().url+"/rest/v1/editorial_permission_outreach?select=id,editorial,recipient_email,status,sent_at,last_error&order=editorial.asc",{headers:headers()});if(!r.ok)throw Error("No se pudo cargar el estado de las solicitudes");return r.json();
 }
 async function invoke(id,dry_run){
 const r=await fetch(cfg().url+"/functions/v1/send-editorial-rights-request",{method:"POST",headers:{...headers(),"Content-Type":"application/json"},body:JSON.stringify({editorial:id,dry_run})});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Error del servidor");return j;
 }
 async function open(){
 if((await me())?.id!==OWNER)return;
 const modal=document.getElementById("modal");if(!modal)return;
 modal.innerHTML='<div class="modalbox mc-editorial-admin"><div class="modalhead"><div><b>Administración · Solicitudes a editoriales</b><div class="muted small">Envíos desde contacto@micomicteca.es</div></div><button class="btn" id="mcMailClose">Cerrar</button></div><div class="modalbody"><div class="mc-admin-notice">Los envíos están restringidos a la cuenta administradora. Solo se utilizará la cuenta oficial una vez configurada la credencial SMTP en Supabase.</div><div id="mcMailList">Cargando…</div><div id="mcMailMessages" role="status"></div><div class="mc-admin-actions"><button class="btn" id="mcMailRefresh">Actualizar</button><button class="btn primary" id="mcMailSendAll">Enviar solicitudes pendientes</button></div></div></div>';modal.classList.remove("hidden");
 document.getElementById("mcMailClose").onclick=()=>window.closeModal?.();
 document.getElementById("mcMailRefresh").onclick=refresh;
 document.getElementById("mcMailSendAll").onclick=sendAll;
 await refresh();
 }
 async function refresh(){
 const box=document.getElementById("mcMailList");if(!box)return;
 try{const rows=await list();box.innerHTML='<div class="mc-editorial-grid">'+rows.map(x=>'<div class="mc-editorial-row"><div><b>'+escape(x.editorial)+'</b><small>'+escape(x.recipient_email)+'</small></div><span class="mc-editorial-state">'+escape(x.status)+'</span></div>').join("")+'</div>';window.mcEditorialRecipients=rows;
 const pending=rows.filter(x=>x.status==="pending").length;
 document.getElementById("mcMailSendAll").disabled=!pending||sending;
 document.getElementById("mcMailSendAll").textContent="Enviar "+pending+" solicitudes pendientes";
 }catch(e){box.textContent=String(e.message||e)}
 }
 async function sendAll(){
 if(sending)return;
 const rows=(window.mcEditorialRecipients||[]).filter(x=>x.status==="pending");
 if(!rows.length)return;
 if(!confirm("¿Enviar "+rows.length+" solicitudes individualizadas desde contacto@micomicteca.es? Los correos incluirán la petición de autorización de uso de portadas."))return;
 sending=true;const status=document.getElementById("mcMailMessages");let sent=0;
 try{
 // Validate endpoint and credentials before sending the first email.
 for(const item of rows){
 status.textContent="Procesando "+item.editorial+" ("+(sent+1)+"/"+rows.length+")…";
 try{await invoke(item.id,false);sent++}catch(e){status.textContent="Detenido en "+item.editorial+": "+String(e.message||e)+". Enviados confirmados: "+sent+". Los demás no se han intentado.";break}
 }
 if(sent===rows.length)status.textContent="Confirmados "+sent+" envíos. Comprueba la recepción de las respuestas en Zimbra.";
 }finally{sending=false;await refresh()}
 }
 window.mcEditorialMail=open;
 async function init(){if((await me())?.id===OWNER)add()}
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();