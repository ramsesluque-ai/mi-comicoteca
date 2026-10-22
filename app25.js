'use strict';
/* v35: durante un lote de portadas, evita sincronizaciones del catálogo entre ficha y ficha. */
(function(){
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
