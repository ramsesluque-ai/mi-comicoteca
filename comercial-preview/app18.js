'use strict';
/* v24: coincidencia estricta de cabecera + UX clara cuando faltan portadas */
function mcSigTokens(v){
  const stop=new Set(['y','e','de','del','la','el','los','las','un','una','vol','volumen','serie','etapa','ecc','forum','zinco','panini','planeta','vertice','bruguera','novaro']);
  return norm(String(v||'').replace(/[–—:_/()]/g,' ').replace(/-/g,' ')).split(/\s+/).filter(t=>t&&t.length>1&&!stop.has(t));
}
function mcSeriesAffinity(a,b){
  const A=[...new Set(mcSigTokens(a))],B=[...new Set(mcSigTokens(b))];
  if(!A.length||!B.length)return 0;
  const inter=A.filter(x=>B.includes(x)).length;
  const union=new Set([...A,...B]).size;
  const jac=union?inter/union:0;
  const contain=inter/Math.max(1,Math.min(A.length,B.length));
  return Math.max(jac,contain*0.9);
}

mcMasterCandidatesForComic=async function(x){
  const rows=await allStore('master'),wanted=String(x.issueNr??x.issue??'').trim(),qs=x.catalogHeader||x.series||'',qp=norm(x.publisher),out=[];
  for(const r of rows){
    const ri=String(r.issueNr??r.issue??'').trim();
    if(wanted&&(!ri||typeof mcIssueExact!=='function'||!mcIssueExact(wanted,ri)))continue;
    const rs=r.catalogHeader||r.series||'',aff=mcSeriesAffinity(qs,rs);
    if(qs&&rs&&aff<0.72)continue;
    const rp=norm(r.publisher);let score=600+Math.round(aff*400);
    if(qp&&rp){if(qp===rp)score+=250;else if(qp.includes(rp)||rp.includes(qp))score+=90;else score-=120}
    if(x.startYear&&r.startYear){if(String(x.startYear)===String(r.startYear))score+=120;else score-=20}
    out.push({source:r.source||'Maestro España',data:{title:r.title||'',publisher:r.publisher||'',publicationDate:r.publicationDate||'',pages:r.pages||'',isbn:r.isbn||'',coverUrl:r.coverUrl||'',volume:r.volume||'',series:rs,issueNr:ri,startYear:r.startYear||'',format:r.format||'',writer:r.authors?.writer||r.writer||'',artist:r.authors?.artist||r.artist||'',inker:r.authors?.inker||r.inker||'',colorist:r.authors?.colorist||r.colorist||'',externalId:r.sourceId||r.externalId||''},_score:score});
  }
  return out.sort((a,b)=>b._score-a._score).slice(0,8);
};

function mcNoCoverPanel(x,quick=false){
  const q=[x.catalogHeader||x.series,x.publisher,x.issueNr&&('nº '+x.issueNr)].filter(Boolean).join(' ');
  const google='https://www.google.com/search?tbm=isch&q='+encodeURIComponent(q+' portada comic');
  const teb='https://www.google.com/search?q='+encodeURIComponent('site:tebeosfera.com '+q);
  return `<div class="notice"><b>He localizado la edición, pero ninguna fuente automática ha devuelto una portada utilizable.</b><br>No voy a mostrar otras series de Batman como sustitutas.</div>
  <div class="result-actions" style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
    <a class="btn" target="_blank" rel="noopener" href="${esc(teb)}">Tebeosfera</a>
    <a class="btn" target="_blank" rel="noopener" href="${esc(google)}">Buscar imagen</a>
    <button class="btn" type="button" onclick="${quick?'mcCancelSeriesQuick()':'mcCancelUnified()'}">Cancelar</button>
  </div>`;
}

const mcRenderUnifiedResultsV23=mcRenderUnifiedResults;
mcRenderUnifiedResults=function(){
  const x=mcFormComic();
  mcUnifiedCandidates=mcUnifiedCandidates.filter(c=>mcSeriesAffinity(x.catalogHeader||x.series,c.data?.series||x.catalogHeader||x.series)>=0.72);
  const withCover=mcUnifiedCandidates.filter(c=>c.data?.coverUrl);
  if(withCover.length)mcUnifiedCandidates=withCover;
  else if(mcUnifiedCandidates.length){mcShowSearch('Resultados: datos y portada',mcNoCoverPanel(x,false));return}
  return mcRenderUnifiedResultsV23();
};

const mcRenderSeriesQuickV23=mcRenderSeriesQuick;
mcRenderSeriesQuick=function(x){
  mcSeriesQuickCandidates=mcSeriesQuickCandidates.filter(c=>mcSeriesAffinity(x.catalogHeader||x.series,c.data?.series||x.catalogHeader||x.series)>=0.72);
  const withCover=mcSeriesQuickCandidates.filter(c=>c.data?.coverUrl);
  if(withCover.length)mcSeriesQuickCandidates=withCover;
  else if(mcSeriesQuickCandidates.length){mcSeriesQuickPanel(mcNoCoverPanel(x,true),'Resultados: datos y portada');return}
  return mcRenderSeriesQuickV23(x);
};
