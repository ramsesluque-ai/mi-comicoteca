'use strict';
/* v60: Maestro, Catálogo, Portadas y búsqueda comparten overlay fresco y portada persistente. */
(function(){
  if(typeof allStore!=='function')return;
  let syncing=false,timer=null;
  const code=v=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const normUrl=v=>String(v||'').trim().replace(/^http:/i,'https:').replace(/[?#].*$/,'');

  function freshen(){
    try{
      if(typeof MCMasterData==='object'&&MCMasterData){
        MCMasterData.index=null;MCMasterData.overrides=null;MCMasterData.isbnIndex=null;
        try{MCMasterData.chunks?.clear?.()}catch{}
      }
    }catch{}
  }
  function exactOverride(x,over){
    const isbn=code(x?.isbn||x?.barcode||'');if(isbn&&over?.[isbn]?.coverUrl)return over[isbn];
    const sid=String(x?.sourceId||'').trim().replace(/^gcd_/i,'');if(sid&&over?.['gcd:'+sid]?.coverUrl)return over['gcd:'+sid];
    const rid=String(x?.masterReconciledId||'').trim().replace(/^gcd_/i,'');if(rid&&over?.['gcd:'+rid]?.coverUrl)return over['gcd:'+rid];
    if(typeof window.mcMasterOverrideFor==='function'){
      const o=window.mcMasterOverrideFor(x,over);if(o?.coverUrl)return o;
    }
    if(typeof window.mcMasterCompositeCoverKey==='function'){
      const k=window.mcMasterCompositeCoverKey(x);if(k&&over?.[k]?.coverUrl)return over[k];
    }
    if(typeof window.mcMasterCompositeCoverKeyNoVolume==='function'){
      const k=window.mcMasterCompositeCoverKeyNoVolume(x);if(k&&over?.[k]?.coverUrl)return over[k];
    }
    return null;
  }
  async function freshOverrides(){
    freshen();
    try{return typeof mcSEOverrides==='function'?await mcSEOverrides():{}}catch{return{}}
  }
  async function syncCatalog(limit=120){
    if(syncing||!window.CoverVault?.attach||document.visibilityState==='hidden'||!navigator.onLine)return;
    syncing=true;const prev=!!window.__mcCoverBatchRunning;window.__mcCoverBatchRunning=true;
    try{
      const [over,rows]=await Promise.all([freshOverrides(),allStore('comics')]);let saved=0,checked=0;
      for(const x of rows){
        if(checked>=limit)break;
        if(!x||x.coverKey)continue;
        const o=exactOverride(x,over),u=String(o?.coverUrl||(Array.isArray(o?.coverUrls)?o.coverUrls[0]:'')||'').trim();
        if(!u)continue;
        if(x.coverRejectedSourceUrl&&normUrl(x.coverRejectedSourceUrl)===normUrl(u))continue;
        checked++;
        try{await window.CoverVault.attach(x,u,{sync:false});saved++}catch(e){console.warn('v60 cover sync',x.id,e)}
      }
      if(saved){try{window.CloudSync?.schedule?.()}catch{};try{window.toast?.(`${saved} portada${saved===1?'':'s'} del Maestro incorporada${saved===1?'':'s'} al catálogo`)}catch{}}
    }finally{window.__mcCoverBatchRunning=prev;syncing=false}
  }
  function schedule(delay=300){clearTimeout(timer);timer=setTimeout(()=>syncCatalog(),Math.max(50,Number(delay)||300))}

  if(typeof window.mcSearchFichaAll==='function'){
    const base=window.mcSearchFichaAll;
    window.mcSearchFichaAll=async function(...a){freshen();try{await window.mcRefreshMasterCoverOverlay?.()}catch{}freshen();return base.apply(this,a)};
    window.mcSearchFichaData=window.mcSearchFichaAll;window.mcSearchFichaCover=window.mcSearchFichaAll;
    window.mcCompleteByCode=async function(){return window.mcSearchFichaAll()};
  }
  if(typeof window.renderMaster==='function'){
    const base=window.renderMaster;
    window.renderMaster=renderMaster=async function(...a){freshen();const r=await base.apply(this,a);try{window.CoverVault?.hydrate?.()}catch{}schedule(100);return r};
  }
  if(typeof window.renderCat==='function'){
    const base=window.renderCat;
    window.renderCat=renderCat=async function(...a){const r=await base.apply(this,a);try{window.CoverVault?.hydrate?.()}catch{}schedule(100);return r};
  }
  if(typeof window.renderCovers==='function'){
    const base=window.renderCovers;
    window.renderCovers=renderCovers=async function(...a){const r=await base.apply(this,a);try{window.CoverVault?.hydrate?.()}catch{}schedule(100);return r};
  }
  window.mcRefreshAllCoversV60=async function(){freshen();try{await window.mcRefreshMasterCoverOverlay?.()}catch{}freshen();await syncCatalog(500);try{await window.mcRepairExistingCovers?.rerun?.()}catch{}try{await render()}catch{}};
  window.addEventListener('load',()=>{freshen();schedule(700);setTimeout(()=>schedule(0),5000)});
  window.addEventListener('focus',()=>{freshen();schedule(250)});
})();
