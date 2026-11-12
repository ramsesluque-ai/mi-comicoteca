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
   panel.style.cssText='position:fixed;z-index:2147483640;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 32px));padding:22px;background:#10253b;color:#fff;border:1px solid #63819b;border-radius:14px;box-shadow:0 8px 50px #000b;font:15px/1.5 system-ui';
   const title=document.createElement('strong');title.textContent='Sincronización manual — pendiente de validación';
   const p=document.createElement('p');p.textContent='La sincronización bidireccional todavía no ha superado las pruebas entre dos dispositivos y de aislamiento por usuario. Por seguridad, no se enviará, modificará ni borrará ningún cómic. Tus datos locales permanecen intactos.';
   const close=document.createElement('button');close.type='button';close.textContent='Entendido';close.style.cssText='padding:9px 16px;border-radius:8px;cursor:pointer';close.onclick=()=>panel.remove();
   panel.append(title,p,close);document.body.append(panel);close.focus();
 }
 function mount(){
   const anchor=findNewComic();
   if(!anchor)return;
   let btn=document.getElementById(ID);
   if(!btn){
     btn=document.createElement('button');btn.id=ID;btn.type='button';btn.textContent='↻ '+text;
     btn.title='Sincronización manual V2: pendiente de pruebas de seguridad';
     btn.style.cssText='display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;min-height:38px;padding:8px 12px;margin-left:8px;border-radius:9px;border:1px solid #4eacc7;background:#123e56;color:#fff;font:600 13px system-ui;cursor:pointer';
     btn.addEventListener('click',showStatus);
   }
   if(anchor.nextElementSibling!==btn)anchor.insertAdjacentElement('afterend',btn);
 }
 let pending=false;
 const observer=new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;mount()})});
 function init(){observer.observe(document.querySelector('#view')||document.body,{childList:true,subtree:true});mount()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();