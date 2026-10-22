'use strict';
/* v37: arranque claro en dispositivos nuevos con copia central existente. */
(function(){
  const RAW='https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/sync-data/comicoteca-sync.enc.json';
  let remoteInfo=null;

  async function inspectRemote(){
    if(remoteInfo)return remoteInfo;
    try{
      const r=await fetch(RAW+'?t='+Date.now(),{cache:'no-store'});
      if(r.ok)remoteInfo=await r.json();
    }catch(e){console.warn('Remote sync check',e)}
    return remoteInfo;
  }

  async function isEmpty(){
    try{return (await allStore('comics')).length===0}catch{return false}
  }

  function syncNotice(){
    const v=remoteInfo?.revision?` · versión ${remoteInfo.revision}`:'';
    return `<div class="notice oknotice" data-remote-sync-notice><b>Copia central cifrada detectada${v}.</b><div class="small muted" style="margin-top:5px">Este navegador todavía no ha descargado tu comicoteca. No importes ningún fichero: introduce tu clave de cifrado y pulsa <b>↓ Cargar última versión</b>. La credencial GitHub no es necesaria para cargar; solo para guardar cambios.</div></div>`;
  }

  const baseDashboard=window.dashboard;
  if(typeof baseDashboard==='function')window.dashboard=async function(){
    let html=await baseDashboard();
    if(await isEmpty()){
      await inspectRemote();
      const generic='<div class="notice"><b>Primera puesta en marcha.</b> Importa tu copia inicial ZIP o JSON desde “Sincronizar”.</div>';
      if(remoteInfo)html=html.replace(generic,syncNotice()+`<div style="margin:-8px 0 18px"><button class="btn primary" onclick="CloudSync.show()">↻ Recuperar mi comicoteca</button></div>`);
      else html=html.replace(generic,'<div class="notice"><b>Este navegador aún no tiene datos locales.</b> Pulsa “Sincronizar” para comprobar si existe una copia central antes de importar ningún fichero.</div>');
    }
    return html;
  };

  function enhanceModal(){
    const body=document.querySelector('.syncbox .modalbody');
    if(!body||body.querySelector('[data-remote-sync-notice]'))return;
    if(remoteInfo)body.insertAdjacentHTML('afterbegin',syncNotice());
    const tokenField=[...body.querySelectorAll('.field')].find(x=>/Credencial GitHub/i.test(x.textContent||''));
    if(tokenField){
      const hint=tokenField.querySelector('.muted.small');
      if(hint)hint.innerHTML='Opcional para <b>cargar</b> tu comicoteca. Solo es necesaria para <b>guardar</b> cambios en la copia central. La credencial se conserva únicamente en este navegador.';
    }
  }

  if(window.CloudSync){
    const baseShow=window.CloudSync.show;
    if(typeof baseShow==='function')window.CloudSync.show=function(){baseShow();enhanceModal()};
    const basePullUI=window.CloudSync.pullUI;
    if(typeof basePullUI==='function')window.CloudSync.pullUI=async function(){
      await basePullUI();
      try{
        const n=(await allStore('comics')).length;
        if(n>0){toast(`Comicoteca recuperada: ${n.toLocaleString('es-ES')} registros`);setTimeout(()=>window.CloudSync.close?.(),700)}
      }catch{}
    };
  }

  window.addEventListener('load',()=>setTimeout(async()=>{
    await inspectRemote();
    if(await isEmpty()){
      enhanceModal();
      if(current==='dashboard')try{await render()}catch{}
    }
  },450));
})();
