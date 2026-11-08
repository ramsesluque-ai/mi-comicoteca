'use strict';
/* v36: modo lote + protección de escrituras GitHub para portadas. */
(function(){
  const HOUR_KEY='mc_cover_write_history_v1';
  const MAX_HOUR=440;
  const MIN_GAP_MS=1200;
  let lastWriteAt=0;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function history(){
    const now=Date.now();let a=[];
    try{a=JSON.parse(localStorage.getItem(HOUR_KEY)||'[]')}catch{}
    a=(Array.isArray(a)?a:[]).map(Number).filter(t=>Number.isFinite(t)&&now-t<3600000);
    localStorage.setItem(HOUR_KEY,JSON.stringify(a));return a;
  }
  function markWrite(){const a=history();a.push(Date.now());localStorage.setItem(HOUR_KEY,JSON.stringify(a))}
  function stopForLimit(msg){
    try{window.AutoCover?.stop?.()}catch{}
    try{toast(msg)}catch{}
  }
  function looksRateLimited(e){const s=String(e?.message||e||'').toLowerCase();return s.includes('(403)')||s.includes('(429)')||s.includes('rate limit')||s.includes('secondary rate')||s.includes('límite')||s.includes('limit exceeded')}
  async function guardWrite(fn,args){
    const a=history();
    if(a.length>=MAX_HOUR){const msg=`Pausa de seguridad: ya se han guardado ${a.length} portadas en la última hora. Continúa más tarde para no superar los límites de GitHub.`;stopForLimit(msg);throw Error(msg)}
    const gap=Date.now()-lastWriteAt;if(lastWriteAt&&gap<MIN_GAP_MS)await sleep(MIN_GAP_MS-gap);
    try{const r=await fn(...args);lastWriteAt=Date.now();markWrite();return r}
    catch(e){if(looksRateLimited(e))stopForLimit('GitHub ha limitado temporalmente las escrituras. El lote se detendrá conservando todo lo ya guardado.');throw e}
  }

  if(window.CoverVault?.attach){const a=window.CoverVault.attach.bind(window.CoverVault);window.CoverVault.attach=(...x)=>guardWrite(a,x)}
  if(window.CoverVault?.attachFile){const a=window.CoverVault.attachFile.bind(window.CoverVault);window.CoverVault.attachFile=(...x)=>guardWrite(a,x)}

  const base=window.AutoCover?.runSelected;
  if(typeof base!=='function')return;
  window.AutoCover.runSelected=async function(...args){
    if(window.__mcCoverBatchRunning)return base(...args);
    window.__mcCoverBatchRunning=true;
    try{return await base(...args)}
    finally{
      window.__mcCoverBatchRunning=false;
      setTimeout(()=>window.CloudSync?.schedule?.(),250);
    }
  };
})();
