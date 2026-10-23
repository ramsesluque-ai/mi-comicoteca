'use strict';
/* v62: Maestro España mezcla base estática, búsquedas interactivas y barrido completo Tebeosfera. */
(function(){
  if(typeof mcSEOverrides!=='function'||typeof MCMasterData==='undefined')return;
  const STATIC='./master-data/cover-overrides.json';
  const DYNAMIC='https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-overrides.json';
  const FULL='https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-full-overrides.json';
  let staticCache=null,dynamicCache={},fullCache={},lastDynamic=0,lastFull=0;

  async function loadStatic(){
    if(staticCache)return staticCache;
    try{const r=await fetch(STATIC,{cache:'force-cache'});staticCache=r.ok?await r.json():{}}catch{staticCache={}}
    return staticCache;
  }
  async function loadRemote(url,kind,force=false){
    const now=Date.now();
    if(kind==='dynamic'){
      if(!force&&now-lastDynamic<10000)return dynamicCache;
      lastDynamic=now;
      try{const r=await fetch(url+'?t='+now,{cache:'no-store'});dynamicCache=r.ok?await r.json():{}}catch{dynamicCache={}}
      return dynamicCache;
    }
    if(!force&&now-lastFull<10000)return fullCache;
    lastFull=now;
    try{const r=await fetch(url+'?t='+now,{cache:'no-store'});fullCache=r.ok?await r.json():{}}catch{fullCache={}}
    return fullCache;
  }
  async function loadDynamic(force=false){return loadRemote(DYNAMIC,'dynamic',force)}
  async function loadFull(force=false){return loadRemote(FULL,'full',force)}

  mcSEOverrides=async function(){
    const [a,b,c]=await Promise.all([loadStatic(),loadDynamic(false),loadFull(false)]);
    const merged={...a,...b,...c};
    MCMasterData.overrides=merged;
    return merged;
  };
  window.mcSEOverrides=mcSEOverrides;
  window.mcRefreshMasterCoverOverlay=async function(){
    await Promise.all([loadDynamic(true),loadFull(true)]);
    MCMasterData.overrides=null;
    if(typeof MCMasterUI!=='undefined'){MCMasterUI.loadedPublisher='';MCMasterUI.rows=[]}
    return mcSEOverrides();
  };
  window.addEventListener('focus',()=>{
    if(Date.now()-Math.min(lastDynamic||0,lastFull||0)>30000)window.mcRefreshMasterCoverOverlay().catch(()=>{});
  });
})();
