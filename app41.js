'use strict';
/* v56: la portada propia (coverKey) se pinta en toda la UI y no se pierde al guardar la ficha. */
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

  /* Compras también debe considerar una portada propia aunque coverUrl esté vacío. */
  if(typeof window.purchasesView==='function'){
    const basePurchases=window.purchasesView;
    window.purchasesView=async function(){
      const html=await basePurchases();
      return html;
    };
  }

  /* Fuerza hidratación tras abrir ficha/listados, además del MutationObserver de vault.js. */
  const kick=()=>setTimeout(()=>window.CoverVault?.hydrate?.(),0);
  if(typeof window.renderCat==='function'){
    const b=window.renderCat;window.renderCat=renderCat=async function(...a){const r=await b.apply(this,a);kick();return r};
  }
  if(typeof window.editComic==='function'){
    const b=window.editComic;window.editComic=editComic=async function(...a){const r=await b.apply(this,a);kick();return r};
  }
  window.addEventListener('load',kick);
})();