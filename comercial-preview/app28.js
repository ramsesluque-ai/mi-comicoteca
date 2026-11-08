'use strict';
/* v65: Maestro mezcla base, interactivo, colección Tebeosfera y fallback exacto. */
(function(){
  if(typeof mcSEOverrides!=='function'||typeof MCMasterData==='undefined')return;
  const STATIC='./master-data/cover-overrides.json';
  const REMOTES=[
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-full-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-shard-0-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-shard-1-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-shard-2-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-shard-3-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-collection-shard-0-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-collection-shard-1-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-collection-shard-2-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-collection-shard-3-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-fallback-shard-0-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-fallback-shard-1-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-fallback-shard-2-overrides.json',
    'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/bridge-data/bridge/cache/master-cover-fallback-shard-3-overrides.json'
  ];
  let staticCache=null;
  const remoteCache=new Map(),remoteAt=new Map();

  async function loadStatic(){
    if(staticCache)return staticCache;
    try{const r=await fetch(STATIC,{cache:'force-cache'});staticCache=r.ok?await r.json():{}}catch{staticCache={}}
    return staticCache;
  }
  async function loadRemote(url,force=false){
    const now=Date.now(),last=remoteAt.get(url)||0;
    if(!force&&now-last<10000)return remoteCache.get(url)||{};
    remoteAt.set(url,now);
    try{
      const r=await fetch(url+'?t='+now,{cache:'no-store'});
      const data=r.ok?await r.json():{};
      remoteCache.set(url,data&&typeof data==='object'?data:{});
    }catch{
      if(!remoteCache.has(url))remoteCache.set(url,{});
    }
    return remoteCache.get(url)||{};
  }
  async function loadAll(force=false){return Promise.all(REMOTES.map(u=>loadRemote(u,force)))}

  mcSEOverrides=async function(){
    const [base,parts]=await Promise.all([loadStatic(),loadAll(false)]);
    const merged=Object.assign({},base,...parts);
    MCMasterData.overrides=merged;
    return merged;
  };
  window.mcSEOverrides=mcSEOverrides;
  window.mcRefreshMasterCoverOverlay=async function(){
    await loadAll(true);
    MCMasterData.overrides=null;
    if(typeof MCMasterUI!=='undefined'){MCMasterUI.loadedPublisher='';MCMasterUI.rows=[]}
    return mcSEOverrides();
  };
  window.addEventListener('focus',()=>{
    const oldest=Math.min(...REMOTES.map(u=>remoteAt.get(u)||0));
    if(Date.now()-oldest>30000)window.mcRefreshMasterCoverOverlay().catch(()=>{});
  });
})();
