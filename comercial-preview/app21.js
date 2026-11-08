'use strict';
/* v27: Tebeosfera pasa a ser la fuente prioritaria del Maestro España. */
const MC_BUILD_V27='v27';

function mcIsTebeosferaSource(c){
  const s=String(c?.source||c?.data?.source||'').toLowerCase();
  const u=String(c?.data?.sourceUrl||c?.sourceUrl||'').toLowerCase();
  return s.includes('tebeosfera')||u.includes('tebeosfera.com');
}

async function mcTebeosferaMasterCandidates(x){
  const rows=await allStore('master');
  const wanted=String(x.issueNr??x.issue??'').trim();
  const qs=x.catalogHeader||x.series||'';
  const qp=norm(x.publisher||'');
  const out=[];
  for(const r of rows){
    const src=String(r.source||'').toLowerCase();
    const url=String(r.sourceUrl||'').toLowerCase();
    if(!src.includes('tebeosfera')&&!url.includes('tebeosfera.com'))continue;
    const ri=String(r.issueNr??r.issue??'').trim();
    if(wanted&&(!ri||typeof mcIssueExact!=='function'||!mcIssueExact(wanted,ri)))continue;
    const rs=r.catalogHeader||r.series||'';
    if(qs&&rs&&typeof mcSeriesAffinity==='function'&&mcSeriesAffinity(qs,rs)<0.72)continue;
    const rp=norm(r.publisher||'');
    if(qp&&rp&&!mcPublisherCompatible(qp,rp))continue;
    let c={
      source:'Tebeosfera',
      data:{
        title:r.title||'',publisher:r.publisher||'',publicationDate:r.publicationDate||'',pages:r.pages||'',
        isbn:r.isbn||'',coverUrl:r.coverUrl||'',volume:r.volume||'',series:rs,issueNr:ri,startYear:r.startYear||'',
        format:r.format||'',writer:r.authors?.writer||r.writer||'',artist:r.authors?.artist||r.artist||'',
        inker:r.authors?.inker||r.inker||'',colorist:r.authors?.colorist||r.colorist||'',
        externalId:r.sourceId||r.externalId||'',sourceUrl:r.sourceUrl||'',_country:'es'
      },
      _score:5000
    };
    if(typeof mcEnrichFullCandidate==='function')c=await mcEnrichFullCandidate(c,x);
    if(typeof mcCandidateCompleteFor==='function'&&mcCandidateCompleteFor(x,c))out.push(c);
  }
  return out.sort((a,b)=>mcCandidateRichScore(b,x)-mcCandidateRichScore(a,x));
}

const mcCollectCompleteCandidatesV26=mcCollectCompleteCandidates;
mcCollectCompleteCandidates=async function(x){
  /* Prioridad absoluta: Tebeosfera ya incorporada al Maestro local. */
  const teb=await mcTebeosferaMasterCandidates(x);
  if(teb.length)return teb.slice(0,12);

  /* Si Tebeosfera aún no tiene esa ficha en el Maestro, usar las fuentes auxiliares. */
  const rest=await mcCollectCompleteCandidatesV26(x);
  rest.sort((a,b)=>{
    const ta=mcIsTebeosferaSource(a)?1:0,tb=mcIsTebeosferaSource(b)?1:0;
    if(ta!==tb)return tb-ta;
    return mcCandidateRichScore(b,x)-mcCandidateRichScore(a,x);
  });
  return rest.slice(0,12);
};

/* Tebeosfera también gana en la ordenación visual si hay varias fuentes para el mismo número. */
const mcCandidateRichScoreV26=mcCandidateRichScore;
mcCandidateRichScore=function(c,x){
  return mcCandidateRichScoreV26(c,x)+(mcIsTebeosferaSource(c)?5000:0);
};

(function(){
  const put=()=>{const el=document.getElementById('mc-build-badge');if(el)el.textContent='MI COMICOTECA '+MC_BUILD_V27};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',put);else put();
})();
