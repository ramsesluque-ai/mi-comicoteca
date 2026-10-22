'use strict';
/* v40: portadas local-first. Completar = pegar localmente; sincronizar = segunda capa cifrada por lotes. */
(function(){
  if(!window.CoverVault)return;

  /* app24 usaba hasCredentials para exigir GitHub incluso al guardar localmente. Desde v40 la copia local no lo necesita. */
  window.CoverVault.hasSyncCredentials=()=>!!(window.CoverVault.passReady?.()&&window.CoverVault.tokenReady?.());
  window.CoverVault.hasCredentials=()=>true;

  const baseRun=window.AutoCover?.runSelected;
  if(typeof baseRun==='function'){
    window.AutoCover.runSelected=async function(...args){
      if(window.__mcCoverBatchRunning)return baseRun(...args);
      window.__mcCoverBatchRunning=true;
      try{return await baseRun(...args)}
      finally{
        window.__mcCoverBatchRunning=false;
        setTimeout(()=>window.CloudSync?.schedule?.(),250);
      }
    };
  }

  const fmtBytes=n=>{n=Number(n||0);if(!n)return'0 MB';return(n/1024/1024).toLocaleString('es-ES',{maximumFractionDigits:1})+' MB'};

  async function enhanceCoverToolbar(){
    const toolbar=document.querySelector('#mcCoverControls .toolbar');
    if(!toolbar||toolbar.querySelector('[data-cover-sync-pending]'))return;
    const [pending,info]=await Promise.all([window.CoverVault.pendingCount?.()||0,window.CoverVault.storageInfo?.()||{}]);
    const btn=document.createElement('button');
    btn.className='btn';btn.dataset.coverSyncPending='1';btn.disabled=!pending;
    btn.textContent=`Sincronizar portadas pendientes (${Number(pending).toLocaleString('es-ES')})`;
    btn.onclick=()=>window.mcSyncPendingCovers?.();
    toolbar.appendChild(btn);
    const local=document.createElement('span');local.className='small muted';local.dataset.coverLocalInfo='1';
    local.textContent=`Almacenamiento local: ${fmtBytes(info.usage)}${info.persisted?' · persistente':' · navegador'}`;
    toolbar.appendChild(local);
  }

  const baseRender=window.renderCovers;
  if(typeof baseRender==='function')window.renderCovers=async function(...args){const r=await baseRender(...args);await enhanceCoverToolbar();return r};

  window.mcSyncPendingCovers=async function(){
    if(!window.CoverVault.hasSyncCredentials()){
      toast('Para sincronizar las portadas a otros dispositivos, carga la clave y la credencial en Sincronizar. Las portadas locales no se pierden.');
      window.CloudSync?.show?.();return;
    }
    const btn=document.querySelector('[data-cover-sync-pending]');if(btn)btn.disabled=true;
    try{
      const r=await window.CoverVault.syncPending(30,p=>{if(btn)btn.textContent=`Sincronizando ${p.done+p.errors}/${p.total} · errores ${p.errors}`});
      toast(`Sincronización de portadas: ${r.done} guardadas${r.errors?` · ${r.errors} incidencias`:''}${r.remaining?` · ${r.remaining} pendientes`:''}`);
    }catch(e){toast(e.message||String(e))}
    finally{try{await window.renderCovers?.()}catch{}}
  };

  window.addEventListener('load',()=>window.CoverVault.ensurePersistent?.());
})();
