'use strict';
/* v45: completar portadas en lote = identidad exacta. Nunca internaliza una URL externa solo por existir. */
(function(){
  if(typeof mcSESearch!=='function'||!window.AutoCover||!window.CoverVault)return;

  const baseSearch=mcSESearch;
  const baseRun=window.AutoCover.runSelected;
  const baseAttach=window.CoverVault.attach;
  const code=v=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const n=v=>typeof mcSENorm==='function'?mcSENorm(v):String(v??'').trim().toLowerCase();
  const issue=v=>typeof mcSEIssue==='function'?mcSEIssue(v):String(v??'').trim().replace(/^0+(?=\d)/,'');
  const canonPub=v=>typeof mcSECanonPub==='function'?mcSECanonPub(v):String(v??'').trim();
  const url=v=>String(v??'').trim().replace(/^http:/i,'https:');

  function exactCandidate(x,c){
    const d=c?.data||{};
    if(!url(d.coverUrl))return false;
    const xi=code(x?.isbn||x?.barcode||''),di=code(d.isbn||'');
    if(xi)return !!di&&xi===di;

    const xIssue=issue(x?.issueNr??x?.issue??''),dIssue=issue(d.issueNr??'');
    if(!xIssue||!dIssue||xIssue!==dIssue)return false;
    if(!x?.publisher||!d.publisher||n(canonPub(x.publisher))!==n(canonPub(d.publisher)))return false;
    const xs=x?.catalogHeader||x?.series||'',ds=d.series||'';
    if(!xs||!ds||n(xs)!==n(ds))return false;

    /* Sin ISBN exigimos además al menos un discriminador de edición y que coincida exactamente. */
    let discriminators=0;
    for(const k of ['volume','stage']){
      const xv=String(x?.[k]??'').trim();
      if(xv){discriminators++;if(!String(d?.[k]??'').trim()||n(xv)!==n(d[k]))return false;}
    }
    const xy=String(x?.startYear??'').trim();
    if(xy){discriminators++;if(String(d?.startYear??'').trim()!==xy)return false;}
    return discriminators>0;
  }

  mcSESearch=async function(x){
    const list=await baseSearch(x);
    if(!window.__mcStrictAutoCover)return list;
    return (list||[]).filter(c=>exactCandidate(x,c));
  };
  window.mcSESearch=mcSESearch;

  if(typeof baseRun==='function'){
    window.AutoCover.runSelected=async function(...args){
      const prev=!!window.__mcStrictAutoCover;
      window.__mcStrictAutoCover=true;
      try{return await baseRun.apply(this,args)}
      finally{window.__mcStrictAutoCover=prev}
    };
  }

  async function exactOverride(x){
    if(typeof mcSEOverrides!=='function')return null;
    const over=await mcSEOverrides();
    const isbn=code(x?.isbn||x?.barcode||'');
    if(isbn&&over?.[isbn]?.coverUrl)return over[isbn];
    const sid=String(x?.sourceId||'').trim();
    if(sid&&over?.['gcd:'+sid]?.coverUrl)return over['gcd:'+sid];
    if(typeof window.mcMasterCompositeCoverKey==='function'){
      const k=window.mcMasterCompositeCoverKey(x);
      if(k&&over?.[k]?.coverUrl)return over[k];
    }
    return null;
  }

  /* app24 trataba coverUrl previa como “asociada”. En lote estricto debe validarse antes de pegarla. */
  window.CoverVault.attach=async function(comic,sourceUrl,opts={}){
    if(window.__mcStrictAutoCover&&url(sourceUrl)&&url(sourceUrl)===url(comic?.coverUrl)){
      const o=await exactOverride(comic);
      const verified=url(o?.coverUrl||(Array.isArray(o?.coverUrls)?o.coverUrls[0]:'')||'');
      if(!verified)throw Error('Portada externa previa no verificada por el Maestro');
      sourceUrl=verified;
    }
    return baseAttach.call(this,comic,sourceUrl,opts);
  };

  window.mcStrictCoverMatch=exactCandidate;
})();
