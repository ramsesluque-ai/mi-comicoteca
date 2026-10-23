'use strict';
/* v57: portada propia en toda la UI + importación de portada desde archivo local en la ficha. */
(function(){
  if(typeof img==='function'){
    const baseImg=img;
    img=function(r,cls='cover'){
      const key=String(r?.coverKey||'').trim();
      if(key){
        const src=String(r?.coverSourceUrl||'').trim();
        return `<div class="${cls} mc-cover-slot coverph" data-cover-key="${esc(key)}" data-cover-source="${esc(src)}">Cargando portada…</div>`;
      }
      return baseImg(r,cls);
    };
    window.img=img;
  }

  /* app4 reconstruía la ficha desde los campos visibles y podía borrar coverKey y metadatos técnicos. */
  if(typeof window.saveComic==='function'&&typeof getStore==='function'&&typeof putStore==='function'){
    const baseSave=window.saveComic;
    window.saveComic=saveComic=async function(id){
      const before=id?await getStore('comics',id):null;
      const typedCover=String(document.getElementById('m_coverUrl')?.value||'').trim();
      await baseSave(id);
      if(!before)return;
      const after=await getStore('comics',id);if(!after)return;
      const next={...after,
        sourceId:before.sourceId||after.sourceId||'',
        barcode:before.barcode||after.barcode||'',
        masterReconciledId:before.masterReconciledId||after.masterReconciledId||'',
        masterReconciledAt:before.masterReconciledAt||after.masterReconciledAt||'',
        masterReconciledFingerprint:before.masterReconciledFingerprint||after.masterReconciledFingerprint||''
      };
      if(!typedCover&&before.coverKey){
        Object.assign(next,{
          coverKey:before.coverKey,
          coverUrl:'',
          coverUrls:Array.isArray(before.coverUrls)?before.coverUrls:[],
          coverSourceUrl:before.coverSourceUrl||'',
          coverSyncPending:before.coverSyncPending===true,
          coverSyncedAt:before.coverSyncedAt||'',
          coverRejectedSourceUrl:before.coverRejectedSourceUrl||'',
          coverRejectedAt:before.coverRejectedAt||''
        });
      }
      await putStore('comics',next);
      try{window.CloudSync?.schedule?.()}catch{}
      try{await render()}catch{}
    };
  }

  async function importLocalCover(input){
    const file=input?.files?.[0];
    if(!file)return;
    input.value='';
    if(!String(file.type||'').startsWith('image/'))return window.toast?.('Selecciona un archivo de imagen');
    if(!window.CoverVault?.attachFile)return window.toast?.('La bóveda de portadas no está disponible');
    try{
      window.busy?.(true,'Guardando portada del ordenador…');
      let record=null;
      if(typeof window.mcPersistFormForCover==='function')record=await window.mcPersistFormForCover();
      if(!record?.id){
        const save=document.querySelector('#modal .modalfoot button[onclick*="saveComic"]');
        const m=String(save?.getAttribute('onclick')||'').match(/saveComic\(['\"]([^'\"]+)['\"]\)/);
        const id=m?.[1]||'';
        record=id&&typeof getStore==='function'?await getStore('comics',id):null;
      }
      if(!record?.id)throw Error('No se pudo identificar la ficha abierta');
      await window.CoverVault.attachFile(record,file,{sync:false});
      try{window.CloudSync?.schedule?.()}catch{}
      window.toast?.('Portada importada y guardada en esta ficha');
      await window.editComic?.(record.id);
    }catch(e){
      console.error(e);
      window.toast?.('No se pudo importar la portada: '+(e?.message||e));
    }finally{
      window.busy?.(false);
    }
  }
  window.mcImportLocalCover=importLocalCover;

  function enhanceCoverImport(){
    const modal=document.getElementById('modal');
    if(!modal||modal.classList.contains('hidden'))return;
    const toolbar=modal.querySelector('.modalbody .formgrid .span4.toolbar');
    if(!toolbar||toolbar.querySelector('[data-local-cover-import]'))return;
    const box=document.createElement('div');
    box.setAttribute('data-local-cover-import','');
    box.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;width:100%;margin-top:8px';
    box.innerHTML=`<input id="mcLocalCoverFile" type="file" accept="image/*" hidden onchange="mcImportLocalCover(this)"><button type="button" class="btn" onclick="document.getElementById('mcLocalCoverFile')?.click()">📁 Importar portada desde el ordenador</button><span class="muted small">La imagen se guarda primero en la bóveda local de la ficha.</span>`;
    toolbar.appendChild(box);
  }

  /* Compras también debe considerar una portada propia aunque coverUrl esté vacío. */
  if(typeof window.purchasesView==='function'){
    const basePurchases=window.purchasesView;
    window.purchasesView=async function(){return await basePurchases()};
  }

  const kick=()=>setTimeout(()=>{window.CoverVault?.hydrate?.();enhanceCoverImport()},0);
  if(typeof window.renderCat==='function'){
    const b=window.renderCat;window.renderCat=renderCat=async function(...a){const r=await b.apply(this,a);kick();return r};
  }
  if(typeof window.editComic==='function'){
    const b=window.editComic;window.editComic=editComic=async function(...a){const r=await b.apply(this,a);kick();return r};
  }
  const modal=document.getElementById('modal');
  if(modal)new MutationObserver(kick).observe(modal,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  window.addEventListener('load',kick);
})();