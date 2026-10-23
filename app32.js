'use strict';
/* v55: Maestro -> Catálogo automático, incluyendo masterReconciledId exacto. */
(function(){
  if(!window.CoverVault||typeof allStore!=='function'||typeof mcSEOverrides!=='function')return;

  const MAX_PER_PASS=40;
  const failedThisSession=new Set();
  let running=false,timer=null,last={checked:0,saved:0,errors:0,remaining:0};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const code=v=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const normUrl=v=>String(v||'').trim().replace(/^http:/i,'https:').replace(/[?#].*$/,'');

  function ownCatalog(x){return x&&x.status==='In Collection'&&!x.coverKey}
  function exactOverride(x,over){
    const isbn=code(x.isbn||x.barcode||'');if(isbn&&over[isbn]?.coverUrl)return over[isbn];
    const sid=String(x.sourceId||'').trim().replace(/^gcd_/i,'');if(sid&&over['gcd:'+sid]?.coverUrl)return over['gcd:'+sid];
    const rid=String(x.masterReconciledId||'').trim().replace(/^gcd_/i,'');if(rid&&over['gcd:'+rid]?.coverUrl)return over['gcd:'+rid];
    if(typeof window.mcMasterCompositeCoverKey==='function'){const k=window.mcMasterCompositeCoverKey(x);if(k&&over[k]?.coverUrl)return over[k]}
    if(typeof window.mcMasterCompositeCoverKeyNoVolume==='function'){const k=window.mcMasterCompositeCoverKeyNoVolume(x);if(k&&over[k]?.coverUrl)return over[k]}
    return null;
  }
  function coverUrl(o){return String(o?.coverUrl||(Array.isArray(o?.coverUrls)?o.coverUrls[0]:'')||'').trim()}
  function rejectedSame(x,u){return !!u&&!!x?.coverRejectedSourceUrl&&normUrl(x.coverRejectedSourceUrl)===normUrl(u)}

  async function run(){
    if(running||window.__mcCoverRepairRunning||window.__mcCatalogReconcileRunning||document.visibilityState==='hidden'||!navigator.onLine)return last;
    running=true;const prevBatch=!!window.__mcCoverBatchRunning;window.__mcCoverBatchRunning=true;
    try{
      const [over,rows]=await Promise.all([mcSEOverrides(),allStore('comics')]);const targets=[];
      for(const x of rows){
        if(!ownCatalog(x)||failedThisSession.has(String(x.id)))continue;
        const o=exactOverride(x,over),u=coverUrl(o);if(u&&!rejectedSame(x,u))targets.push({x,o,u});
      }
      const batch=targets.slice(0,MAX_PER_PASS);let saved=0,errors=0;
      for(const {x,u} of batch){
        try{await window.CoverVault.attach(x,u,{sync:false});saved++}
        catch(e){console.warn('Maestro -> Catálogo',x.id,e);failedThisSession.add(String(x.id));errors++}
        await sleep(120);
      }
      last={checked:batch.length,saved,errors,remaining:Math.max(0,targets.length-batch.length)};
      if(saved&&typeof toast==='function')toast(`Maestro: ${saved} portada${saved===1?'':'s'} incorporada${saved===1?'':'s'} automáticamente a tu catálogo`);
      if(last.remaining>0)schedule(1200);return last;
    }catch(e){console.warn('AutoMasterCover',e);return last}
    finally{window.__mcCoverBatchRunning=prevBatch;running=false;try{if(typeof window.renderCovers==='function'&&document.querySelector('#mcCoverControls'))await window.renderCovers()}catch{}}
  }
  function schedule(delay=800){clearTimeout(timer);timer=setTimeout(()=>run(),Math.max(100,Number(delay)||800))}
  if(typeof window.mcRefreshMasterCoverOverlay==='function'){const baseRefresh=window.mcRefreshMasterCoverOverlay;window.mcRefreshMasterCoverOverlay=async function(...args){const r=await baseRefresh.apply(this,args);schedule(350);return r}}
  if(window.CloudSync?.pull){const basePull=window.CloudSync.pull;window.CloudSync.pull=async function(...args){const r=await basePull.apply(this,args);schedule(500);return r}}
  if(window.CloudSync?.pullUI){const basePullUI=window.CloudSync.pullUI;window.CloudSync.pullUI=async function(...args){const r=await basePullUI.apply(this,args);schedule(700);return r}}
  window.mcAutoImportMasterCovers={run,schedule,status:()=>({...last,running})};
  window.addEventListener('load',()=>{schedule(1800);setTimeout(()=>schedule(0),8000)});window.addEventListener('focus',()=>schedule(1200));
})();