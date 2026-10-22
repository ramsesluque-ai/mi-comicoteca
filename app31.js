'use strict';
/* v42: overlays del Maestro por ISBN, sourceId GCD exacto y clave bibliográfica compuesta. */
(function(){
  if(typeof mcSECode!=='function'||typeof mcSENorm!=='function'||typeof mcSEIssue!=='function')return;

  function compositeKey(r){
    const pub=typeof mcSECanonPub==='function'?mcSECanonPub(r?.publisher||''):(r?.publisher||'');
    const series=r?.catalogHeader||r?.series||'';
    const issue=r?.issueNr??r?.issue??'';
    return '@:'+[
      mcSENorm(pub),
      mcSENorm(series),
      mcSENorm(r?.volume||''),
      mcSENorm(r?.stage||''),
      String(r?.startYear||'').trim(),
      mcSEIssue(issue)
    ].join('|');
  }
  function overrideFor(r,over){
    over=over||{};
    const isbn=mcSECode(r?.isbn||r?.barcode||'');
    const sid=String(r?.sourceId||'').trim();
    return (isbn&&over[isbn])||(sid&&over['gcd:'+sid])||over[compositeKey(r)]||null;
  }
  window.mcMasterCompositeCoverKey=compositeKey;
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

  if(typeof mcMasterEnrichRows==='function'){
    mcMasterEnrichRows=async function(rows){
      const over=await mcSEOverrides();
      return rows.map(r=>{
        const o=overrideFor(r,over)||{};
        return{...r,
          title:o.title||r.title||'',publisher:o.publisher||r.publisher||'',
          catalogHeader:o.series||r.catalogHeader||r.series||'',series:o.series||r.series||r.catalogHeader||'',
          issueNr:o.issueNr||r.issueNr||r.issue||'',issue:o.issueNr||r.issue||r.issueNr||'',
          publicationDate:o.publicationDate||r.publicationDate||'',pages:o.pages||r.pages||'',
          isbn:o.isbn||r.isbn||'',coverUrl:o.coverUrl||r.coverUrl||'',sourceUrl:o.sourceUrl||r.sourceUrl||''
        };
      });
    };
    window.mcMasterEnrichRows=mcMasterEnrichRows;
  }
})();
