'use strict';
/* v48: overlays del Maestro sin alterar identidad; admite alias histórico sin volumen. */
(function(){
  if(typeof mcSECode!=='function'||typeof mcSENorm!=='function'||typeof mcSEIssue!=='function')return;

  function compositeKey(r,blankVolume=false){
    const pub=typeof mcSECanonPub==='function'?mcSECanonPub(r?.publisher||''):(r?.publisher||'');
    const series=r?.catalogHeader||r?.series||'';
    const issue=r?.issueNr??r?.issue??'';
    return '@:'+[
      mcSENorm(pub),
      mcSENorm(series),
      blankVolume?'':mcSENorm(r?.volume||''),
      mcSENorm(r?.stage||''),
      String(r?.startYear||'').trim(),
      mcSEIssue(issue)
    ].join('|');
  }
  function overrideFor(r,over){
    over=over||{};
    const isbn=mcSECode(r?.isbn||r?.barcode||'');
    const sid=String(r?.sourceId||'').trim();
    return (isbn&&over[isbn])||(sid&&over['gcd:'+sid])||over[compositeKey(r)]||over[compositeKey(r,true)]||null;
  }
  window.mcMasterCompositeCoverKey=r=>compositeKey(r,false);
  window.mcMasterCompositeCoverKeyNoVolume=r=>compositeKey(r,true);
  window.mcMasterOverrideFor=overrideFor;

  if(typeof mcSEFromRow==='function'){
    const baseFromRow=mcSEFromRow;
    mcSEFromRow=function(x,r,overrides){
      const over=overrides||{},o=overrideFor(r,over);
      if(!o)return baseFromRow(x,r,over);
      const isbn=mcSECode(r?.isbn||r?.barcode||'');
      if(isbn&&over[isbn]===o)return baseFromRow(x,r,over);
      const local=Object.create(over);local[isbn]=o;
      return baseFromRow(x,r,local);
    };
    window.mcSEFromRow=mcSEFromRow;
  }

  /* El overlay de portada nunca cambia la identidad estructural del Maestro. */
  if(typeof mcMasterEnrichRows==='function'){
    mcMasterEnrichRows=async function(rows){
      const over=await mcSEOverrides();
      return rows.map(r=>{
        const o=overrideFor(r,over)||{};
        return{...r,
          title:o.title||r.title||'',
          publicationDate:o.publicationDate||r.publicationDate||'',
          pages:o.pages||r.pages||'',
          isbn:r.isbn||o.isbn||'',
          coverUrl:o.coverUrl||r.coverUrl||'',
          sourceUrl:o.sourceUrl||r.sourceUrl||''
        };
      });
    };
    window.mcMasterEnrichRows=mcMasterEnrichRows;
  }
})();