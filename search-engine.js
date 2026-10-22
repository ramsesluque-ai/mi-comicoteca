'use strict';
/* MI COMICOTECA v30 - motor único de búsqueda de datos y portadas.
   Sustituye la cadena histórica de búsquedas/overrides. */

const MC_SEARCH_BUILD='v30';
const MCSearch={ficha:[],quick:[],selectedFicha:0,selectedQuick:0,quickId:'',quickEncoded:'',quickScroll:0};

function mcSENorm(v){return norm(String(v??''));}
function mcSECode(v){return String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();}
function mcSEIssue(v){
  const s=String(v??'').trim().toLowerCase().replace(/[º°]/g,'').replace(/\s+/g,'');
  if(/^0*\d+$/.test(s))return String(parseInt(s,10));
  return s.replace(/^0+(?=\d)/,'');
}
function mcSEIssueExact(a,b){return !!mcSEIssue(a)&&mcSEIssue(a)===mcSEIssue(b);}
function mcSEExtractIssue(text){
  const t=String(text||'').replace(/\u00a0/g,' ');
  const re=[/(?:núm(?:ero)?|num(?:ero)?|n[º°o]\.?|#)\s*0*(\d{1,4})(?!\d)/i,/(?:issue|number)\s*#?\s*0*(\d{1,4})(?!\d)/i];
  for(const r of re){const m=t.match(r);if(m)return String(parseInt(m[1],10));}
  return '';
}
function mcSETokens(v){
  const stop=new Set(['de','del','la','el','los','las','y','e','vol','volumen','serie','etapa','ecc','ediciones','forum','zinco','panini','planeta','bruguera','novaro']);
  return mcSENorm(v).replace(/[^a-z0-9áéíóúüñ]+/gi,' ').split(/\s+/).filter(x=>x&&x.length>1&&!stop.has(x));
}
function mcSESeriesScore(a,b){
  const A=[...new Set(mcSETokens(a))],B=[...new Set(mcSETokens(b))];
  if(!A.length||!B.length)return 0;
  const inter=A.filter(x=>B.includes(x)).length;
  return Math.max(inter/A.length,inter/B.length);
}
function mcSEPubCompatible(a,b){
  const A=mcSENorm(a),B=mcSENorm(b);if(!A||!B)return true;
  if(A===B||A.includes(B)||B.includes(A))return true;
  const ta=mcSETokens(A),tb=mcSETokens(B);return ta.some(x=>tb.includes(x));
}
function mcSENameVariants(x){
  const out=[];const add=v=>{v=String(v||'').replace(/\s+/g,' ').trim();if(v&&!out.some(z=>mcSENorm(z)===mcSENorm(v)))out.push(v)};
  const base=[x.catalogHeader,x.series].filter(Boolean),stage=String(x.stage||'').trim(),pub=String(x.publisher||'').trim();
  for(const raw of base){
    add(raw);
    if(stage&&!mcSENorm(raw).includes(mcSENorm(stage))){add(`${raw}: ${stage}`);add(`${raw} ${stage}`)}
    if(pub){const rx=new RegExp('\\s*[-–—:]?\\s*'+pub.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$','i');add(raw.replace(rx,''));}
    const parts=raw.split(/\s+-\s+/);if(parts.length>1)add(parts[0]);
  }
  return out.slice(0,8);
}
function mcSETimeout(ms){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);return{signal:c.signal,done:()=>clearTimeout(t)}}
async function mcSEJson(url,ms=5500,opts={}){
  const t=mcSETimeout(ms);
  try{const r=await fetch(url,{...opts,signal:t.signal,cache:'no-store'});if(!r.ok)return null;return await r.json()}catch{return null}finally{t.done()}
}
function mcSECoverUrls(v){
  const out=[];const add=u=>{u=String(u||'').trim().replace(/^http:/,'https:');if(/^https?:\/\//i.test(u)&&!out.includes(u))out.push(u)};
  const walk=o=>{
    if(!o)return;if(typeof o==='string'){add(o);return;}if(Array.isArray(o)){o.forEach(walk);return;}if(typeof o==='object'){
      ['extraLarge','large','medium','small','thumbnail','smallThumbnail','image','image_url','url','file','scan'].forEach(k=>walk(o[k]));
    }
  };walk(v);return out;
}
function mcSEMergeCovers(...lists){const out=[];for(const l of lists.flat()){const u=String(l||'').trim().replace(/^http:/,'https:');if(/^https?:\/\//i.test(u)&&!out.includes(u))out.push(u)}return out;}
function mcSECandidate(source,data,score=0,covers=[]){
  const all=mcSEMergeCovers(covers,data?.coverUrls||[],data?.coverUrl||'');
  return {source,data:{...data,coverUrls:all,coverUrl:all[0]||''},score};
}
function mcSECandidateKey(c){const d=c.data||{};return [mcSECode(d.isbn),mcSENorm(d.series),mcSEIssue(d.issueNr),mcSENorm(d.title),d.coverUrl].join('|')}
function mcSEValid(x,c){
  const d=c?.data||{},wanted=mcSEIssue(x.issueNr??x.issue??'');
  if(wanted&&!mcSEIssueExact(wanted,d.issueNr))return false;
  if(!d.coverUrl)return false;
  const q=x.catalogHeader||x.series||'',s=d.series||q;
  if(q&&s&&mcSESeriesScore(q,s)<0.55)return false;
  if(x.publisher&&d.publisher&&!mcSEPubCompatible(x.publisher,d.publisher))return false;
  return !!(d.title||d.series||d.isbn||d.publisher);
}
function mcSESort(x,a,b){
  const q=x.catalogHeader||x.series||'';
  const score=c=>{
    const d=c.data||{};let s=Number(c.score||0);
    if(String(c.source).toLowerCase().includes('tebeosfera'))s+=5000;
    if(d.isbn)s+=350;if(d.pages)s+=60;if(d.publicationDate)s+=50;
    s+=Math.round(mcSESeriesScore(q,d.series||q)*800);
    if(x.publisher&&d.publisher&&mcSEPubCompatible(x.publisher,d.publisher))s+=250;
    return s;
  };
  return score(b)-score(a);
}

async function mcSELookupIsbn(isbn,x){
  const code=mcSECode(isbn);if(code.length<10)return null;
  const wanted=mcSEIssue(x.issueNr??x.issue??''),series=x.catalogHeader||x.series||'';
  const [ol,gb]=await Promise.all([
    mcSEJson('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent('ISBN:'+code)+'&format=json&jscmd=data',4500),
    mcSEJson('https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent('isbn:'+code)+'&maxResults=5',4500)
  ]);
  const covers=[];let data={isbn:code,series,issueNr:wanted,publisher:x.publisher||'',title:'',publicationDate:'',pages:'',writer:''};
  const ob=ol?.['ISBN:'+code];
  if(ob){
    covers.push(...mcSECoverUrls(ob.cover));
    data={...data,title:ob.title||data.title,publisher:ob.publishers?.[0]?.name||data.publisher,publicationDate:mcNormalizeDate(ob.publish_date),pages:ob.number_of_pages||data.pages,writer:(ob.authors||[]).map(a=>a.name).filter(Boolean).join(', ')||data.writer};
  }
  for(const it of gb?.items||[]){
    const v=it.volumeInfo||{},ids=(v.industryIdentifiers||[]).map(z=>mcSECode(z.identifier));
    if(ids.length&&!ids.includes(code))continue;
    covers.push(...mcSECoverUrls(v.imageLinks));
    data={...data,title:data.title||v.title||'',publisher:data.publisher||v.publisher||'',publicationDate:data.publicationDate||mcNormalizeDate(v.publishedDate),pages:data.pages||v.pageCount||'',writer:data.writer||(v.authors||[]).join(', ')};
  }
  const cu=mcSEMergeCovers(covers);
  if(!cu.length&&!data.title)return null;
  return mcSECandidate('ISBN exacto',data,3500,cu);
}

async function mcSELocalMaster(x){
  const rows=await allStore('master'),wanted=mcSEIssue(x.issueNr??x.issue??''),q=x.catalogHeader||x.series||'',out=[];
  for(const r of rows){
    if(wanted&&!mcSEIssueExact(wanted,r.issueNr??r.issue??''))continue;
    const rs=r.catalogHeader||r.series||'';if(q&&rs&&mcSESeriesScore(q,rs)<0.65)continue;
    if(x.publisher&&r.publisher&&!mcSEPubCompatible(x.publisher,r.publisher))continue;
    let covers=mcSEMergeCovers(r.coverUrl||'');let extra=null;
    if(r.isbn){extra=await mcSELookupIsbn(r.isbn,x);covers=mcSEMergeCovers(covers,extra?.data?.coverUrls||[]);}
    const src=String(r.source||'Maestro España');
    out.push(mcSECandidate(src,{title:r.title||extra?.data?.title||'',publisher:r.publisher||extra?.data?.publisher||'',publicationDate:r.publicationDate||extra?.data?.publicationDate||'',pages:r.pages||extra?.data?.pages||'',isbn:r.isbn||extra?.data?.isbn||'',series:rs||q,issueNr:r.issueNr??r.issue??wanted,volume:r.volume||'',startYear:r.startYear||'',format:r.format||'',writer:r.authors?.writer||r.writer||extra?.data?.writer||'',artist:r.authors?.artist||r.artist||'',inker:r.authors?.inker||r.inker||'',colorist:r.authors?.colorist||r.colorist||''},src.toLowerCase().includes('tebeosfera')?5000:1800,covers));
  }
  return out.filter(c=>mcSEValid(x,c));
}

function mcSEGcdPublisher(v,fallback=''){
  if(!v)return fallback;if(typeof v==='string'&&!/^https?:\/\//i.test(v))return v;if(typeof v==='object')return v.name||v.publisher_name||fallback;return fallback;
}
async function mcSEGcdDetail(it){
  const u=it?.api_url||it?.url;if(!u)return it||{};return await mcSEJson(u,5000,{headers:{Accept:'application/json'}})||it||{};
}
async function mcSEGcdCover(d){
  let covers=mcSECoverUrls(d.cover);
  if(typeof d.cover==='string'&&/\/api\//i.test(d.cover)){
    const j=await mcSEJson(d.cover,3500,{headers:{Accept:'application/json'}});covers=mcSEMergeCovers(covers,mcSECoverUrls(j));
  }
  return covers;
}
async function mcSEGcd(x){
  const wanted=mcSEIssue(x.issueNr??x.issue??'');if(!wanted)return[];
  const out=[],seen=new Set();
  for(const name of mcSENameVariants(x)){
    const j=await mcSEJson('https://www.comics.org/api/series/name/'+encodeURIComponent(name)+'/issue/'+encodeURIComponent(wanted)+'/',5200,{headers:{Accept:'application/json'}});
    const arr=Array.isArray(j)?j:(j?.results||[]);if(!arr.length)continue;
    const details=await Promise.all(arr.slice(0,8).map(mcSEGcdDetail));
    for(const d of details){
      const actual=mcSEIssue(d.number??d.issue_number??'');if(!mcSEIssueExact(wanted,actual))continue;
      const series=d.series_name||d.series?.name||name;if(mcSESeriesScore(x.catalogHeader||x.series||name,series)<0.55)continue;
      const isbn=mcSECode(d.isbn||d.barcode||'');
      const id=String(d.api_url||d.id||[series,actual,d.publication_date].join('|'));if(seen.has(id))continue;seen.add(id);
      let covers=await mcSEGcdCover(d),isbnData=null;
      if(isbn){isbnData=await mcSELookupIsbn(isbn,{...x,catalogHeader:series,series,issueNr:wanted});covers=mcSEMergeCovers(isbnData?.data?.coverUrls||[],covers);}
      const stories=d.story_set||[];
      const c=mcSECandidate('Grand Comics Database',{title:d.title||d.descriptor||isbnData?.data?.title||'',publisher:mcSEGcdPublisher(d.indicia_publisher,x.publisher||isbnData?.data?.publisher||''),publicationDate:mcNormalizeDate(d.publication_date)||isbnData?.data?.publicationDate||'',pages:d.page_count||isbnData?.data?.pages||'',isbn:isbn||isbnData?.data?.isbn||'',series,issueNr:actual,volume:d.volume||'',startYear:x.startYear||'',format:d.binding||'',writer:stories.map(s=>s.script).filter(Boolean).join(', ')||isbnData?.data?.writer||'',artist:stories.map(s=>s.pencils).filter(Boolean).join(', '),inker:stories.map(s=>s.inks).filter(Boolean).join(', '),colorist:stories.map(s=>s.colors).filter(Boolean).join(', ')},3000,covers);
      if(mcSEValid(x,c))out.push(c);
    }
    if(out.length)break;
  }
  return out;
}

async function mcSEBooks(x){
  const wanted=mcSEIssue(x.issueNr??x.issue??''),series=x.catalogHeader||x.series||'';if(!series||!wanted)return[];
  const queries=[`${series} núm. ${wanted}`,`${series} nº ${wanted}`,`${series} ${wanted} ${x.publisher||''}`],out=[],seen=new Set();
  for(const q of queries){
    const [gb,ol]=await Promise.all([
      mcSEJson('https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent(q)+'&maxResults=20&printType=books',4500),
      mcSEJson('https://openlibrary.org/search.json?q='+encodeURIComponent(q)+'&limit=30&language=spa',4500)
    ]);
    for(const it of gb?.items||[]){
      const v=it.volumeInfo||{},title=[v.title,v.subtitle].filter(Boolean).join(' '),issue=mcSEExtractIssue(title);if(!mcSEIssueExact(wanted,issue))continue;
      if(mcSESeriesScore(series,title)<0.55)continue;
      const isbn=mcSECode(((v.industryIdentifiers||[]).find(z=>z.type==='ISBN_13')||(v.industryIdentifiers||[])[0]||{}).identifier||'');
      const covers=mcSECoverUrls(v.imageLinks),key=isbn||mcSENorm(title);if(seen.has(key))continue;seen.add(key);
      const c=mcSECandidate('Google Books',{title:v.title||title,publisher:v.publisher||x.publisher||'',publicationDate:mcNormalizeDate(v.publishedDate),pages:v.pageCount||'',isbn,series,issueNr:issue,writer:(v.authors||[]).join(', ')},1500,covers);if(mcSEValid(x,c))out.push(c);
    }
    for(const d of ol?.docs||[]){
      const title=String(d.title||''),issue=mcSEExtractIssue(title);if(!mcSEIssueExact(wanted,issue))continue;
      if(mcSESeriesScore(series,title)<0.55)continue;
      const isbn=mcSECode((d.isbn||[])[0]||''),covers=d.cover_i?['https://covers.openlibrary.org/b/id/'+d.cover_i+'-L.jpg']:[];
      const key=isbn||mcSENorm(title);if(seen.has(key))continue;seen.add(key);
      const c=mcSECandidate('Open Library',{title,publisher:(d.publisher||[])[0]||x.publisher||'',publicationDate:d.first_publish_year?d.first_publish_year+'-01-01':'',pages:d.number_of_pages_median||'',isbn,series,issueNr:issue,writer:(d.author_name||[]).join(', ')},1300,covers);if(mcSEValid(x,c))out.push(c);
    }
    if(out.length)break;
  }
  return out;
}

async function mcSESearch(x){
  const wanted=mcSEIssue(x.issueNr??x.issue??'');
  if(!wanted&&!mcSECode(x.isbn||''))return[];
  const result=[],seen=new Set();const add=c=>{if(!c||!mcSEValid(x,c))return;const k=mcSECandidateKey(c);if(seen.has(k))return;seen.add(k);result.push(c)};
  const local=await mcSELocalMaster(x);local.forEach(add);
  const exactTeb=local.filter(c=>String(c.source).toLowerCase().includes('tebeosfera'));
  if(exactTeb.length)return exactTeb.sort((a,b)=>mcSESort(x,a,b)).slice(0,8);
  const code=mcSECode(x.isbn||'');if(code){const c=await mcSELookupIsbn(code,x);add(c);}
  const [gcd,books]=await Promise.all([mcSEGcd(x),mcSEBooks(x)]);gcd.forEach(add);books.forEach(add);
  return result.sort((a,b)=>mcSESort(x,a,b)).slice(0,10);
}

function mcSERenderCards(list,selected,selectFn){
  return `<div class="ficha-result-grid unified-results">${list.map((c,i)=>{const d=c.data||{};return `<article class="ficha-result unified-result ${i===selected?'selected':''}" onclick="${selectFn}(${i})" style="cursor:pointer"><div class="result-pick"><input type="radio" ${i===selected?'checked':''} onclick="event.stopPropagation();${selectFn}(${i})"></div><img src="${esc(d.coverUrl)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.closest('article').style.opacity='.45'"><div><span class="source-pill">${esc(c.source)}</span><b>${esc(d.title||d.series||'Resultado')}</b><div class="small muted">${esc([d.publisher,d.series,d.issueNr?('Nº '+d.issueNr):'',d.publicationDate,d.isbn?('ISBN '+d.isbn):''].filter(Boolean).join(' · '))}</div></div></article>`}).join('')}</div>`;
}
function mcSEEmpty(x){return `<div class="notice"><b>No se ha encontrado una coincidencia completa para ${esc(x.catalogHeader||x.series||'esta ficha')} nº ${esc(x.issueNr||x.issue||'')}.</b><br>El motor solo devuelve el número exacto con datos y portada; no sustituye por otros números.</div>`}
function mcSESelectFicha(i){MCSearch.selectedFicha=i;document.querySelectorAll('#mcFichaSearchBox .unified-result').forEach((e,n)=>e.classList.toggle('selected',n===i));}
function mcSESelectQuick(i){MCSearch.selectedQuick=i;document.querySelectorAll('#mcSeriesQuickPanel .unified-result').forEach((e,n)=>e.classList.toggle('selected',n===i));}

mcSearchFichaAll=async function(){
  const x=mcFormComic();if(!mcSEIssue(x.issueNr??x.issue??'')&&!mcSECode(x.isbn||''))return toast('Informa al menos el número de la serie o un ISBN/EAN');
  MCSearch.ficha=[];MCSearch.selectedFicha=0;mcShowSearch('Buscar datos y portada',`<div class="muted">Buscando ${esc(x.catalogHeader||x.series||'')} · nº ${esc(x.issueNr||x.issue||'')}…</div>`);
  const list=await mcSESearch(x);MCSearch.ficha=list;
  if(!list.length)return mcShowSearch('Resultados: datos y portada',mcSEEmpty(x)+`<div class="result-actions"><button class="btn" onclick="mcCancelUnified()">Cancelar</button></div>`);
  mcShowSearch('Resultados: datos y portada',mcSERenderCards(list,0,'mcSESelectFicha')+`<div class="result-actions"><button class="btn" onclick="mcCancelUnified()">Cancelar</button><button class="btn primary" onclick="mcAcceptUnified()">Aceptar</button></div>`);
};
mcSearchFichaData=mcSearchFichaAll;mcSearchFichaCover=mcSearchFichaAll;
mcCompleteByCode=async function(){await mcSearchFichaAll()};
function mcCancelUnified(){MCSearch.ficha=[];MCSearch.selectedFicha=0;const b=document.getElementById('mcFichaSearchBox');if(b)b.classList.add('hidden');}
async function mcSEApplyFields(d){
  mcSetBlank('publisher',d.publisher);mcSetBlank('catalogHeader',d.series);mcSetBlank('series',d.series);mcSetBlank('volume',d.volume);mcSetBlank('title',d.title);mcSetBlank('publicationDate',d.publicationDate);mcSetBlank('pages',d.pages);mcSetBlank('isbn',d.isbn);mcSetBlank('format',d.format);mcSetBlank('writer',d.writer);mcSetBlank('artist',d.artist);mcSetBlank('inker',d.inker);mcSetBlank('colorist',d.colorist);
}
async function mcSEAttachCover(record,candidate){
  const urls=candidate.data?.coverUrls||[candidate.data?.coverUrl].filter(Boolean),errors=[];
  for(const u of urls){try{return await CoverVault.attach(record,u)}catch(e){errors.push(e?.message||String(e))}}
  throw Error(errors[0]||'No se pudo guardar la portada');
}
async function mcAcceptUnified(){
  const c=MCSearch.ficha[MCSearch.selectedFicha];if(!c)return toast('Selecciona un resultado');
  busy(true,'Guardando datos y portada…');
  try{await mcSEApplyFields(c.data||{});const r=await mcPersistFormForCover();await mcSEAttachCover(r,c);toast('Datos y portada guardados');await editComic(r.id)}catch(e){toast('No se pudo completar la ficha: '+(e.message||e))}finally{busy(false)}
}

mcQuickSearchSeriesIssue=async function(id,encoded,ev){
  ev?.stopPropagation?.();mcRememberSeriesScroll();mcSeriesReturnEncoded=encoded;MCSearch.quickId=id;MCSearch.quickEncoded=encoded;MCSearch.quickScroll=$('#modal .modalbody')?.scrollTop||0;MCSearch.quick=[];MCSearch.selectedQuick=0;
  const x=await getStore('comics',id);if(!x)return toast('No se encontró la ficha');
  mcSeriesQuickPanel(`<div class="muted">Buscando ${esc(x.catalogHeader||x.series||'')} · nº ${esc(x.issueNr||x.issue||'')}…</div>`);
  const list=await mcSESearch(x);MCSearch.quick=list;
  if(!list.length)return mcSeriesQuickPanel(mcSEEmpty(x)+`<div class="result-actions"><button class="btn" onclick="mcCancelSeriesQuick()">Cancelar</button></div>`,'Resultados');
  mcSeriesQuickPanel(mcSERenderCards(list,0,'mcSESelectQuick')+`<div class="result-actions"><button class="btn" onclick="mcCancelSeriesQuick()">Cancelar</button><button class="btn primary" onclick="mcAcceptSeriesQuick()">Aceptar</button></div>`,'Resultados: datos y portada');
};
async function mcAcceptSeriesQuick(){
  const c=MCSearch.quick[MCSearch.selectedQuick],id=MCSearch.quickId;if(!c||!id)return toast('Selecciona un resultado');
  const x=await getStore('comics',id);if(!x)return toast('No se encontró la ficha');const d=c.data||{},a=x.authors||{};
  const y=cleanComic({...x,publisher:x.publisher||d.publisher,catalogHeader:x.catalogHeader||x.series||d.series,series:x.series||x.catalogHeader||d.series,volume:x.volume||d.volume,startYear:x.startYear||d.startYear,title:x.title||d.title,publicationDate:x.publicationDate||d.publicationDate,pages:x.pages||d.pages,isbn:x.isbn||d.isbn,format:x.format||d.format,authors:{...a,writer:a.writer||d.writer||'',artist:a.artist||d.artist||'',inker:a.inker||d.inker||'',colorist:a.colorist||d.colorist||''}});
  busy(true,'Guardando datos y portada…');
  try{await putStore('comics',y);if(!x.coverKey&&!x.coverUrl)await mcSEAttachCover(y,c);const enc=MCSearch.quickEncoded,scroll=MCSearch.quickScroll;mcCancelSeriesQuick();toast('Datos y portada guardados');await openSeries(enc);const b=$('#modal .modalbody');if(b)b.scrollTop=scroll}catch(e){toast('No se pudo completar la ficha: '+(e.message||e))}finally{busy(false)}
}

(function(){
  const s=document.createElement('style');s.id='mc-search-engine-style';s.textContent=`#mcFichaSearchBox .result-actions,#mcSeriesQuickPanel .result-actions{position:sticky;bottom:0;z-index:30;display:flex;gap:10px;justify-content:flex-end;padding:12px;background:#071829;border-top:1px solid #294764}.unified-result.selected{outline:2px solid #5c7cff}`;document.head.appendChild(s);
  const put=()=>{let e=document.getElementById('mc-build-badge');if(!e){e=document.createElement('div');e.id='mc-build-badge';e.style.cssText='position:fixed;right:8px;bottom:8px;z-index:9999;font:11px system-ui;padding:4px 7px;border-radius:8px;background:#071829cc;color:#8fb7dc;border:1px solid #294764;pointer-events:none';document.body.appendChild(e)}e.textContent='MI COMICOTECA '+MC_SEARCH_BUILD};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',put);else put();
})();
