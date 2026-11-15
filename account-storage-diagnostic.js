'use strict';
/* Fail-visible diagnostic for the account-scoped IndexedDB selection.
 * Read-only: does not create, delete, migrate, or open another user's database.
 * Prevents a missing tab session from masquerading as a deleted collection.
 */
(function(){
 if(new URLSearchParams(location.search).get('modo')==='prueba-importacion')return;
 const SESSION='mc_supabase_session_v1';
 function account(){try{return JSON.parse(sessionStorage.getItem(SESSION)||'null')?.user?.id||null}catch{return null}}
 async function inspect(){
  if(typeof DBN!=='string'||typeof allStore!=='function')return;
  const uid=account(),current=DBN;
  let count=null;try{count=(await allStore('comics')).length}catch(_){}
  if(uid&&current==='comicteca-user-'+uid&&count>0)return;
  let databases=[];
  try{if(typeof indexedDB.databases==='function')databases=(await indexedDB.databases()).map(x=>x.name).filter(x=>x?.startsWith('comicteca-'))}catch(_){}
  const other=databases.filter(n=>n!==current&&n.startsWith('comicteca-user-'));
  const suspicious=!uid||!current.startsWith('comicteca-user-')||(count===0&&other.length>0);
  if(!suspicious)return;
  const old=document.getElementById('mc-storage-account-warning');if(old)old.remove();
  const el=document.createElement('aside');el.id='mc-storage-account-warning';el.setAttribute('role','alert');
  el.style.cssText='position:fixed;z-index:2147483640;top:8px;left:50%;transform:translateX(-50%);width:min(620px,calc(100vw - 24px));background:#422b13;color:#fff;border:2px solid #ffc66c;border-radius:10px;padding:12px 16px;font:14px/1.5 system-ui;box-shadow:0 5px 25px #0008';
  const title=document.createElement('strong');title.textContent='Atención: la colección puede estar oculta, no borrada.';
  const message=document.createElement('p');message.style.margin='6px 0';
  message.textContent=!uid?'No se detecta una sesión de usuario en esta pestaña. La aplicación ha seleccionado un almacenamiento de invitado, distinto del de tu cuenta. No importes, sincronices ni restaures hasta iniciar sesión y comprobar el catálogo.':count===0&&other.length?'La base de esta sesión aparece vacía y el navegador conserva otra base de usuario. No se ha eliminado ninguna ficha por esta comprobación. Verifica la cuenta antes de restaurar.':'La base local no coincide con la cuenta esperada. Comprueba tu sesión.';
  const details=document.createElement('small');details.textContent='Base seleccionada: '+current+' · Fichas visibles: '+(count===null?'sin verificar':count)+'. Diagnóstico solo lectura.';
  const close=document.createElement('button');close.textContent='Cerrar aviso';close.style.cssText='display:block;margin-top:8px;padding:5px 10px';close.onclick=()=>el.remove();
  el.append(title,message,details,close);document.body.appendChild(el);
 }
 document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>inspect().catch(e=>console.warn('Storage account diagnostic',e)),1000));
})();
