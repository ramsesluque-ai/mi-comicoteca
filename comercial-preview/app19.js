'use strict';
/* v25: solo mostrar resultados completos (portada + datos) y resolver portada por ISBN exacto antes de rendirse. */
const MC_BUILD='v25';

function mcNormIsbn(v){return String(v||'').replace(/[^0-9Xx]/g,'').toUpperCase()}
function mcPublisherCompatible(a,b){
  const A=norm(a||''),B=norm(b||'');if(!A||!B)return true;
  if(A===B||A.includes(B)||B.includes(A))return true;
  if((A.includes('ecc')&&B.includes('ecc')))return true;
  return false;
}
function mcCandidateCompleteFor(x,c){
  const d=c?.data||{},wanted=String(x.issueNr??x.issue??'').trim();
  if(!d.coverUrl)return false;
  if(wanted&&(!d.issueNr||typeof mcIssueExact!=='function'||!mcIssueExact(wanted,d.issueNr)))return false;
  const qs=x.catalogHeader||x.series||'',ds=d.series||qs;
  if(qs&&ds&&typeof mcSeriesAffinity==='function'&&mcSeriesAffinity(qs,ds)<0.76)return false;
  if(!mcPublisherCompatible(x.publisher,d.publisher))return false;
  const info=[d.title,d.publisher,d.isbn,d.publicationDate,d.pages,d.writer,d.artist].filter(v=>String(v||'').trim()).length;
  return info>=2;
}
async function mcGoogleByIsbn(isbn,x,wanted){
  const code=mcNormIsbn(isbn);if(!code)return null;
  try{
    const r=await fetch('https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent('isbn:'+code)+'&maxResults=10',{cache:'no-store'});
    if(r.ok){
      const j=await r.json();
      for(const it of j.items||[]){
        const v=it.volumeInfo||{},ids=v.industryIdentifiers||[];
        const found=mcNormIsbn((ids.find(z=>z.type==='ISBN_13')||ids.find(z=>z.type==='ISBN_10')||ids[0]||{}).identifier||code);
        if(found&&found!==code)continue;
        let cover=v.imageLinks?.extraLarge||v.imageLinks?.large||v.imageLinks?.medium||v.imageLinks?.small||v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||'';
        cover=String(cover||'').replace(/^http:/,'https:');
        if(!cover)continue;
        return {source:'Google Books · ISBN exacto',data:{title:v.title||'',publisher:v.publisher||x.publisher||'',publicationDate:mcNormalizeDate(v.publishedDate),pages:v.pageCount||'',isbn:code,coverUrl:cover,series:x.catalogHeader||x.series||'',issueNr:wanted||String(x.issueNr??x.issue??''),startYear:x.startYear||'',format:v.printType||'',writer:(v.authors||[]).join(', '),externalId:it.id||'',_exactCode:true,_country:'es'},_score:2200};
      }
    }
  }catch{}
  try{
    const key='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(key)+'&format=json&jscmd=data',{cache:'no-store'}),j=await r.json(),b=j[key];
    const cover=b?.cover?.large||b?.cover?.medium||b?.cover?.small||'';
    if(b&&cover)return {source:'Open Library · ISBN exacto',data:{title:b.title||'',publisher:b.publishers?.[0]?.name||x.publisher||'',publicationDate:mcNormalizeDate(b.publish_date),pages:b.number_of_pages||'',isbn:code,coverUrl:cover,series:x.catalogHeader||x.series||'',issueNr:wanted||String(x.issueNr??x.issue??''),startYear:x.startYear||'',writer:(b.authors||[]).map(a=>a.name).filter(Boolean).join(', '),_exactCode:true,_country:'es'},_score:2100};
  }catch{}
  return null;
}
async function mcEnrichFullCandidate(c,x){
  if(!c)return null;const d=c.data||{},wanted=String(x.issueNr??x.issue??'').trim();
  if(d.coverUrl)return c;
  const isbn=mcNormIsbn(d.isbn||'');
  if(!isbn)return c;
  const exact=await mcGoogleByIsbn(isbn,x,wanted);
  if(!exact)return c;
  c.data={...d,...Object.fromEntries(Object.entries(exact.data).filter(([,v])=>String(v??'').trim()!=='')),series:d.series||exact.data.series,issueNr:d.issueNr||exact.data.issueNr,isbn:d.isbn||exact.data.isbn};
  c.source=(c.source||'Datos')+' + '+exact.source;
  c._score=(c._score||0)+1200;
  return c;
}
async function mcCollectCompleteCandidates(x){
  const wanted=String(x.issueNr??x.issue??'').trim(),code=mcNormIsbn(x.isbn||''),pool=[],seen=new Set();
  const add=async c=>{if(!c)return;c=await mcEnrichFullCandidate(c,x);const d=c.data||{},k=[mcNormIsbn(d.isbn),mcLooseSeriesName(d.series||''),String(d.issueNr||''),norm(d.title||'')].join('|');if(seen.has(k))return;seen.add(k);pool.push(c)};
  if(code)await add(await mcGoogleByIsbn(code,x,wanted));
  if(wanted&&typeof mcGcdCandidatesForComic==='function')for(const c of await mcGcdCandidatesForComic(x))await add(c);
  if(typeof mcMasterCandidatesForComic==='function')for(const c of await mcMasterCandidatesForComic(x))await add(c);
  if(typeof mcGoogleBooksCandidatesForComic==='function')for(const c of await mcGoogleBooksCandidatesForComic(x))await add(c);
  const valid=pool.filter(c=>mcCandidateCompleteFor(x,c));
  valid.sort((a,b)=>mcCandidateRichScore(b,x)-mcCandidateRichScore(a,x));
  return valid.slice(0,12);
}
function mcNoCompleteResult(x,quick=false){
  const q=[x.catalogHeader||x.series,x.publisher,x.issueNr&&('nº '+x.issueNr)].filter(Boolean).join(' '),teb='https://www.google.com/search?q='+encodeURIComponent('site:tebeosfera.com '+q),imgq='https://www.google.com/search?tbm=isch&q='+encodeURIComponent(q+' portada');
  return `<div class="notice"><b>No se mostrará ningún resultado incompleto.</b><br>La búsqueda no ha conseguido todavía una coincidencia con <b>portada + datos bibliográficos + número exacto</b>.</div><div class="result-actions" style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px"><a class="btn" target="_blank" rel="noopener" href="${esc(teb)}">Buscar en Tebeosfera</a><a class="btn" target="_blank" rel="noopener" href="${esc(imgq)}">Buscar portada</a><button class="btn" type="button" onclick="${quick?'mcCancelSeriesQuick()':'mcCancelUnified()'}">Cancelar</button></div>`;
}

mcSearchFichaAll=async function(){
  const x=mcFormComic(),series=x.catalogHeader||x.series,title=x.title||'',code=mcNormIsbn(x.isbn||'');
  if(!code&&!series&&!title)return toast('Informa un código, cabecera/serie o título para buscar');
  mcUnifiedCandidates=[];mcUnifiedSelected=0;mcShowSearch('Buscar datos y portada',`<div class="muted">Buscando coincidencia completa para ${esc(series||title)}${x.issueNr?' · nº '+esc(x.issueNr):''}…</div>`);
  try{
    mcUnifiedCandidates=await mcCollectCompleteCandidates(x);mcUnifiedSelected=0;
    if(mcUnifiedCandidates.length)return mcRenderUnifiedResults();
    mcShowSearch('Resultados: datos y portada',mcNoCompleteResult(x,false));
  }catch(e){mcShowSearch('Resultados: datos y portada',`<div class="notice">No se pudo completar la búsqueda: ${esc(e.message||e)}</div>${mcNoCompleteResult(x,false)}`)}
};

mcQuickSearchSeriesIssue=async function(id,encoded,ev){
  ev?.stopPropagation?.();mcRememberSeriesScroll();mcSeriesReturnEncoded=encoded;mcSeriesQuickId=id;mcSeriesQuickCandidates=[];mcSeriesQuickSelected=0;
  const x=await getStore('comics',id);if(!x)return toast('No se encontró la ficha');
  mcSeriesQuickPanel(`<div class="muted">Buscando coincidencia completa para ${esc(x.catalogHeader||x.series)}${x.issueNr?' · nº '+esc(x.issueNr):''}…</div>`);
  try{
    mcSeriesQuickCandidates=await mcCollectCompleteCandidates(x);mcSeriesQuickSelected=0;
    if(mcSeriesQuickCandidates.length)return mcRenderSeriesQuick(x);
    mcSeriesQuickPanel(mcNoCompleteResult(x,true),'Resultados: datos y portada');
  }catch(e){mcSeriesQuickPanel(`<div class="notice">No se pudo completar la búsqueda: ${esc(e.message||e)}</div>${mcNoCompleteResult(x,true)}`,'Resultados: datos y portada')}
};

/* Mostrar versión activa y forzar comprobación del service worker para evitar PWA antigua. */
(function(){
  const put=()=>{let el=document.getElementById('mc-build-badge');if(!el){el=document.createElement('div');el.id='mc-build-badge';el.style.cssText='position:fixed;right:8px;bottom:8px;z-index:9999;font:11px system-ui;padding:4px 7px;border-radius:8px;background:#071829cc;color:#8fb7dc;border:1px solid #294764;pointer-events:none';document.body.appendChild(el)}el.textContent='MI COMICOTECA '+MC_BUILD};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',put);else put();
  if('serviceWorker'in navigator)navigator.serviceWorker.getRegistration().then(r=>r?.update?.()).catch(()=>{});
})();
