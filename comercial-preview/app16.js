'use strict';
/* v22: búsqueda resiliente. Prioridad Maestro local -> GCD -> Google Books/ISBN. */

function mcIssueTextMatch(text,wanted){
  const t=String(text||'').toLowerCase().replace(/[º°]/g,'o');
  const w=String(wanted||'').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(!w)return true;
  const pats=[
    new RegExp('(?:n(?:u|ú)m(?:ero)?\\.?|n\\.?o\\.?|#|tomo|vol(?:umen)?\\.?)\\s*0*'+w+'(?!\\d)','i'),
    new RegExp('\\b0*'+w+'\\b','i')
  ];
  return pats.some(r=>r.test(t));
}
function mcLooseSeriesName(v){
  return norm(String(v||'').replace(/\s+-\s+[^-]+$/,'').replace(/\([^)]*\)$/,'').trim());
}
function mcMasterCandidatesForComic(x){
  return allStore('master').then(rows=>{
    const wanted=String(x.issueNr??x.issue??'').trim(),qs=mcLooseSeriesName(x.catalogHeader||x.series),qp=norm(x.publisher);
    return rows.map(r=>{
      const rs=mcLooseSeriesName(r.catalogHeader||r.series),rp=norm(r.publisher),ri=String(r.issueNr??r.issue??'').trim();
      let score=0;
      if(wanted&&typeof mcIssueExact==='function'&&mcIssueExact(wanted,ri))score+=600;else if(wanted)return null;
      if(qs&&rs){if(qs===rs)score+=300;else if(qs.includes(rs)||rs.includes(qs))score+=170;else return null}
      if(qp&&rp){if(qp===rp)score+=250;else if(qp.includes(rp)||rp.includes(qp))score+=120}
      if(x.startYear&&r.startYear&&String(x.startYear)===String(r.startYear))score+=120;
      return {source:r.source||'Maestro España',data:{title:r.title||'',publisher:r.publisher||'',publicationDate:r.publicationDate||'',pages:r.pages||'',isbn:r.isbn||'',coverUrl:r.coverUrl||'',volume:r.volume||'',series:r.catalogHeader||r.series||'',issueNr:ri,startYear:r.startYear||'',format:r.format||'',writer:r.authors?.writer||r.writer||'',artist:r.authors?.artist||r.artist||'',inker:r.authors?.inker||r.inker||'',colorist:r.authors?.colorist||r.colorist||'',externalId:r.sourceId||r.externalId||''},_score:score};
    }).filter(Boolean).sort((a,b)=>b._score-a._score).slice(0,8);
  });
}

function mcGoogleBookData(it,x,wanted){
  const v=it?.volumeInfo||{},ids=v.industryIdentifiers||[];
  const isbn=(ids.find(z=>z.type==='ISBN_13')||ids.find(z=>z.type==='ISBN_10')||ids[0]||{}).identifier||'';
  let cover=v.imageLinks?.extraLarge||v.imageLinks?.large||v.imageLinks?.medium||v.imageLinks?.small||v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||'';
  cover=String(cover||'').replace(/^http:/,'https:');
  const title=[v.title,v.subtitle].filter(Boolean).join(' '),pub=v.publisher||'';
  const series=x.catalogHeader||x.series||'';
  let score=0;
  const qs=mcLooseSeriesName(series),qt=mcLooseSeriesName(title),qp=norm(x.publisher),dp=norm(pub);
  if(qs&&qt){if(qt.includes(qs)||qs.includes(qt))score+=280}
  if(wanted&&mcIssueTextMatch(title,wanted))score+=500;else if(wanted)return null;
  if(qp&&dp){if(qp===dp)score+=220;else if(qp.includes(dp)||dp.includes(qp))score+=110}
  const y=String(v.publishedDate||'').match(/\d{4}/)?.[0]||'';
  if(x.startYear&&y&&String(x.startYear)===y)score+=80;
  return {source:'Google Books · edición',data:{title:v.title||'',publisher:pub,publicationDate:mcNormalizeDate(v.publishedDate),pages:v.pageCount||'',isbn,coverUrl:cover,series,issueNr:wanted,startYear:x.startYear||y,format:v.printType||'',writer:(v.authors||[]).join(', '),externalId:it.id||'',_country:'es'},_score:score};
}
async function mcGoogleBooksCandidatesForComic(x){
  const series=(x.catalogHeader||x.series||'').replace(/\s+-\s+[^-]+$/,'').trim(),wanted=String(x.issueNr??x.issue??'').trim(),pub=x.publisher||'';
  if(!series)return[];
  const queries=[`"${series}" ${wanted} "${pub}"`,`intitle:${series} ${wanted} ${pub}`],out=[],seen=new Set();
  for(const q of queries){
    try{
      const u='https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent(q)+'&maxResults=40&printType=books';
      const r=await fetch(u,{cache:'no-store'});if(!r.ok)continue;const j=await r.json();
      for(const it of j.items||[]){const c=mcGoogleBookData(it,x,wanted);if(!c)continue;const k=c.data.isbn||c.data.externalId||c.data.title;if(seen.has(k))continue;seen.add(k);out.push(c)}
    }catch{}
    if(out.length>=8)break;
  }
  return out.sort((a,b)=>b._score-a._score).slice(0,10);
}
async function mcEnrichCandidateCover(c){
  const d=c?.data||{};if(d.coverUrl||!d.isbn)return c;
  try{const k='ISBN:'+String(d.isbn).replace(/[^0-9Xx]/g,''),r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(k)+'&format=json&jscmd=data'),j=await r.json(),b=j[k];if(b?.cover)c.data.coverUrl=b.cover.large||b.cover.medium||b.cover.small||''}catch{}
  return c;
}
async function mcFallbackCandidates(x){
  const out=[];const add=c=>{if(!c)return;const k=[c.data?.isbn,c.data?.series,c.data?.issueNr,c.data?.title].join('|');if(!out.some(z=>[z.data?.isbn,z.data?.series,z.data?.issueNr,z.data?.title].join('|')===k))out.push(c)};
  for(const c of await mcMasterCandidatesForComic(x))add(c);
  for(const c of await mcGoogleBooksCandidatesForComic(x))add(await mcEnrichCandidateCover(c));
  return out.slice(0,12);
}
function mcTebeosferaHelp(x){
  const q=[x.catalogHeader||x.series,x.publisher,x.issueNr&&('nº '+x.issueNr)].filter(Boolean).join(' ');
  const u='https://www.google.com/search?q='+encodeURIComponent('site:tebeosfera.com '+q);
  return `<div class="notice" style="margin-top:12px"><b>Tebeosfera puede tener esta edición aunque bloquee la consulta automática.</b><br><a class="btn sm" target="_blank" rel="noopener" href="${esc(u)}">Abrir búsqueda en Tebeosfera</a></div>`;
}

const mcSearchFichaAllV21=mcSearchFichaAll;
mcSearchFichaAll=async function(){
  await mcSearchFichaAllV21();
  if(mcUnifiedCandidates.length)return;
  const x=mcFormComic();
  mcShowSearch('Buscar datos y portada','<div class="muted">Probando Maestro España y fuentes bibliográficas alternativas…</div>');
  const extra=await mcFallbackCandidates(x);for(const c of extra)mcAddUnified(c.source,c.data);
  if(mcUnifiedCandidates.length){mcUnifiedSelected=0;mcRenderUnifiedResults();return}
  mcShowSearch('Resultados: datos y portada',`<div class="notice">No se encontró una coincidencia automática fiable para <b>${esc(x.catalogHeader||x.series)} nº ${esc(x.issueNr||x.issue||'')}</b>.</div>${mcTebeosferaHelp(x)}<div class="result-actions" style="margin-top:12px"><button class="btn" type="button" onclick="mcCancelUnified()">Cancelar</button></div>`);
};

const mcQuickSearchSeriesIssueV21=mcQuickSearchSeriesIssue;
mcQuickSearchSeriesIssue=async function(id,encoded,ev){
  await mcQuickSearchSeriesIssueV21(id,encoded,ev);
  if(mcSeriesQuickCandidates.length)return;
  const x=await getStore('comics',id);if(!x)return;
  mcSeriesQuickPanel('<div class="muted">Probando Maestro España y fuentes bibliográficas alternativas…</div>');
  const extra=await mcFallbackCandidates(x);for(const c of extra)mcSeriesQuickAdd(c.source,c.data);
  if(mcSeriesQuickCandidates.length){mcSeriesQuickSelected=0;mcRenderSeriesQuick(x);return}
  mcSeriesQuickPanel(`<div class="notice">No se encontró una coincidencia automática fiable para <b>${esc(x.catalogHeader||x.series)} nº ${esc(x.issueNr||x.issue||'')}</b>.</div>${mcTebeosferaHelp(x)}<div class="result-actions" style="margin-top:12px"><button class="btn" onclick="mcCancelSeriesQuick()">Cancelar</button></div>`,'Resultados');
};
