'use strict';
/* v23: enriquecer portadas del Maestro + priorizar candidatos con portada + acciones Aceptar/Cancelar fijas */

function mcCandidateRichScore(c,x){
  const d=c?.data||{};let s=Number(c?._score||0);
  if(d.coverUrl)s+=500;
  if(d.isbn)s+=180;
  if(d.pages)s+=40;
  if(d.publicationDate)s+=40;
  if(d.publisher)s+=30;
  if(d.writer||d.artist)s+=25;
  if(x){
    const qp=norm(x.publisher||''),dp=norm(d.publisher||'');
    const qs=mcLooseSeriesName(x.catalogHeader||x.series||''),ds=mcLooseSeriesName(d.series||'');
    if(qp&&dp&&qp===dp)s+=220;
    if(qs&&ds&&qs===ds)s+=260;
    const wi=String(x.issueNr??x.issue??'').trim(),di=String(d.issueNr??'').trim();
    if(wi&&di&&typeof mcIssueExact==='function'&&mcIssueExact(wi,di))s+=400;
  }
  return s;
}

async function mcFallbackCandidates(x){
  const out=[],seen=new Set();
  const add=async c=>{
    if(!c)return;
    c=await mcEnrichCandidateCover(c);
    const d=c.data||{},k=[String(d.isbn||'').replace(/\W/g,''),mcLooseSeriesName(d.series||''),String(d.issueNr||''),norm(d.title||'')].join('|');
    if(seen.has(k))return;seen.add(k);out.push(c);
  };
  /* Maestro primero, pero enriqueciendo sus ISBN antes de mostrarlo */
  for(const c of await mcMasterCandidatesForComic(x))await add(c);
  /* Fuentes abiertas para portada/datos cuando el Maestro no tenga imagen */
  for(const c of await mcGoogleBooksCandidatesForComic(x))await add(c);
  out.sort((a,b)=>mcCandidateRichScore(b,x)-mcCandidateRichScore(a,x));
  return out.slice(0,14);
}

function mcEnsureResultActionsSticky(){
  if(document.getElementById('mc-v23-style'))return;
  const s=document.createElement('style');s.id='mc-v23-style';s.textContent=`
    #mcFichaSearchBox .result-actions,#mcSeriesQuickPanel .result-actions{
      position:sticky;bottom:0;z-index:20;padding:12px 10px;margin-left:-2px;margin-right:-2px;
      background:linear-gradient(180deg,rgba(7,24,41,.78) 0%,#071829 32%);
      border-top:1px solid #294764;backdrop-filter:blur(8px)
    }
    #mcFichaSearchBox .unified-result.selected,#mcSeriesQuickPanel .unified-result.selected{
      outline:2px solid #5c7cff;box-shadow:0 0 0 3px rgba(92,124,255,.15) inset
    }
    #mcFichaSearchBox .ficha-search-content,#mcSeriesQuickPanel .ficha-search-content{position:relative}
  `;document.head.appendChild(s);
}
mcEnsureResultActionsSticky();

/* Reordenar justo antes de pintar resultados para que una portada disponible gane a una ficha vacía. */
const mcRenderUnifiedResultsV22=mcRenderUnifiedResults;
mcRenderUnifiedResults=function(){
  try{const x=mcFormComic();mcUnifiedCandidates.sort((a,b)=>mcCandidateRichScore(b,x)-mcCandidateRichScore(a,x));}catch{}
  mcUnifiedSelected=Math.min(mcUnifiedSelected||0,Math.max(0,mcUnifiedCandidates.length-1));
  return mcRenderUnifiedResultsV22();
};

const mcRenderSeriesQuickV22=mcRenderSeriesQuick;
mcRenderSeriesQuick=function(x){
  try{mcSeriesQuickCandidates.sort((a,b)=>mcCandidateRichScore(b,x)-mcCandidateRichScore(a,x));}catch{}
  mcSeriesQuickSelected=Math.min(mcSeriesQuickSelected||0,Math.max(0,mcSeriesQuickCandidates.length-1));
  return mcRenderSeriesQuickV22(x);
};
