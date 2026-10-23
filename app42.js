'use strict';
/* v58: Datos + portada consulta también el overlay exacto del registro reconciliado del Maestro. */
(function(){
  if(typeof window.mcSearchFichaAll!=='function')return;
  const baseSearch=window.mcSearchFichaAll;

  function currentComicId(){
    const save=document.querySelector('#modal .modalfoot button[onclick*="saveComic"]');
    const m=String(save?.getAttribute('onclick')||'').match(/saveComic\(['\"]([^'\"]+)['\"]\)/);
    return m?.[1]||'';
  }

  async function exactOverlayCandidate(x){
    if(typeof mcSEOverrides!=='function'||typeof mcMasterOverrideFor!=='function')return null;
    const id=currentComicId();
    const comic=id&&typeof getStore==='function'?await getStore('comics',id):null;
    const rows=[];
    if(comic)rows.push(comic);
    if(comic?.masterReconciledId&&typeof getStore==='function'){
      const m=await getStore('master',comic.masterReconciledId).catch(()=>null);
      if(m)rows.push(m);
    }
    const over=await mcSEOverrides();
    for(const r of rows){
      const o=mcMasterOverrideFor(r,over);
      if(!o?.coverUrl)continue;
      const d={
        title:o.title||r.title||'',
        publisher:r.publisher||o.publisher||x.publisher||'',
        publicationDate:o.publicationDate||r.publicationDate||'',
        pages:o.pages||r.pages||'',
        isbn:r.isbn||o.isbn||x.isbn||'',
        series:r.catalogHeader||r.series||o.series||x.catalogHeader||x.series||'',
        issueNr:r.issueNr??r.issue??o.issueNr??x.issueNr??x.issue??'',
        volume:r.volume||'',stage:r.stage||'',startYear:r.startYear||'',format:r.format||'',color:r.color||'',
        coverUrl:o.coverUrl,coverUrls:[o.coverUrl],sourceUrl:o.sourceUrl||''
      };
      const c=mcSECandidate('Maestro España · '+(o.source||'Tebeosfera reconciliada'),d,32000,[o.coverUrl]);
      if(typeof mcSEValid!=='function'||mcSEValid(x,c,true))return c;
    }
    return null;
  }

  window.mcSearchFichaAll=async function(){
    const x=typeof mcFormComic==='function'?mcFormComic():null;
    if(x){
      try{
        if(window.mcRefreshMasterCoverOverlay)await window.mcRefreshMasterCoverOverlay();
        const hit=await exactOverlayCandidate(x);
        if(hit){
          MCSearch.ficha=[hit];MCSearch.selectedFicha=0;MCSearch.lastDataOnly=1;
          mcShowSearch('Resultados: datos y portada',mcSERenderCards(MCSearch.ficha,0,'mcSESelectFicha')+`<div class="result-actions"><button class="btn" onclick="mcCancelUnified()">Cancelar</button><button class="btn primary" onclick="mcAcceptUnified()">Aceptar</button></div>`);
          return;
        }
      }catch(e){console.warn('Overlay reconciliado de ficha',e)}
    }
    return baseSearch();
  };
  window.mcSearchFichaData=window.mcSearchFichaAll;
  window.mcSearchFichaCover=window.mcSearchFichaAll;
  window.mcCompleteByCode=async function(){await window.mcSearchFichaAll()};
})();