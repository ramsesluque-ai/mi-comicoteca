'use strict';
/* v39: Maestro España mezcla su base estática con portadas verificadas del bridge, por ISBN. */
(function(){
  if(typeof mcSEOverrides!=='function'||typeof MCMasterData==='undefined')return;
  const STATIC='./master-data/cover-overrides.json';
  const DYNAMIC='https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-overrides.json';
  let staticCache=null,dynamicCache={},lastDynamic=0;

  async function loadStatic(){
    if(staticCache)return staticCache;
    try{const r=await fetch(STATIC,{cache:'force-cache'});staticCache=r.ok?await r.json():{}}catch{staticCache={}}
    return staticCache;
  }
  async function loadDynamic(force=false){
    if(!force&&Date.now()-lastDynamic<10000)return dynamicCache;
    lastDynamic=Date.now();
    try{const r=await fetch(DYNAMIC+'?t='+Date.now(),{cache:'no-store'});dynamicCache=r.ok?await r.json():{}}catch{dynamicCache={}}
    return dynamicCache;
  }
  mcSEOverrides=async function(){
    const [a,b]=await Promise.all([loadStatic(),loadDynamic(false)]),merged={...a,...b};
    MCMasterData.overrides=merged;
    return merged;
  };
  window.mcSEOverrides=mcSEOverrides;
  window.mcRefreshMasterCoverOverlay=async function(){
    await loadDynamic(true);MCMasterData.overrides=null;
    if(typeof MCMasterUI!=='undefined'){MCMasterUI.loadedPublisher='';MCMasterUI.rows=[]}
    return mcSEOverrides();
  };
  window.addEventListener('focus',()=>{if(Date.now()-lastDynamic>30000)window.mcRefreshMasterCoverOverlay().catch(()=>{})});
})();
