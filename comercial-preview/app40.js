'use strict';
/* v54: recuperación local de la clave de cifrado desde el propio dispositivo. */
(function(){
  const PK='mc_sync_pass_v1';

  function savedPass(){
    return String(localStorage.getItem(PK)||sessionStorage.getItem(PK)||'');
  }

  function syncBody(){
    return document.querySelector('.syncbox .modalbody');
  }

  function enhance(){
    const body=syncBody();
    if(!body||body.querySelector('[data-saved-pass-tools]'))return;
    const input=body.querySelector('#syncPass');
    if(!input)return;
    const p=savedPass();
    if(!p)return;

    const box=document.createElement('div');
    box.setAttribute('data-saved-pass-tools','');
    box.style.cssText='margin:8px 0 4px;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
    box.innerHTML=`
      <button type="button" class="btn sm" onclick="mcRevealSavedSyncPass()">👁 Mostrar clave guardada</button>
      <button type="button" class="btn sm" onclick="mcCopySavedSyncPass()">📋 Copiar clave guardada</button>
      <div class="muted small" style="width:100%">Esta clave procede únicamente del almacenamiento de este dispositivo. No se envía a GitHub ni a ningún servicio externo.</div>`;

    const field=input.closest('.field');
    (field||input.parentElement)?.insertAdjacentElement('afterend',box);
  }

  window.mcRevealSavedSyncPass=function(){
    const p=savedPass();
    const input=document.getElementById('syncPass');
    if(!p){window.toast?.('Este dispositivo no tiene ninguna clave guardada');return}
    if(input){
      input.value=p;
      input.type='text';
      input.setAttribute('data-revealed-saved-pass','1');
      input.focus();
      try{input.setSelectionRange(0,input.value.length)}catch{}
    }
    window.toast?.('Clave guardada mostrada en este dispositivo');
  };

  window.mcCopySavedSyncPass=async function(){
    const p=savedPass();
    if(!p){window.toast?.('Este dispositivo no tiene ninguna clave guardada');return}
    try{
      await navigator.clipboard.writeText(p);
      window.toast?.('Clave guardada copiada al portapapeles');
      return;
    }catch{}
    const ta=document.createElement('textarea');
    ta.value=p;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');window.toast?.('Clave guardada copiada al portapapeles')}
    catch{window.toast?.('No se pudo copiar automáticamente. Usa “Mostrar clave guardada”.')}
    finally{ta.remove()}
  };

  /* La ventana puede abrirse desde el botón, desde el arranque automático o desde app26. */
  const modal=document.getElementById('modal');
  if(modal){
    new MutationObserver(()=>enhance()).observe(modal,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  }
  window.addEventListener('load',()=>{setTimeout(enhance,250);setTimeout(enhance,900)});

  if(window.CloudSync?.show){
    const base=window.CloudSync.show;
    window.CloudSync.show=function(...args){const r=base.apply(this,args);setTimeout(enhance,0);return r};
  }
})();
