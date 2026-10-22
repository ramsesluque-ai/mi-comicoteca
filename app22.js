'use strict';
/* v28: recuperación del buscador permisivo de v14, manteniendo nº exacto y prioridad Tebeosfera local. */
const MC_BUILD_V28='v28';

function mcIsbnDigits(v){return String(v||'').replace(/[^0-9Xx]/g,'').toUpperCase()}
function mcIsbnDbCover(isbn){
  const c=mcIsbnDigits(isbn);if(c.length<10)return'';
  const last4=c.slice(-4);return `https://images.isbndb.com/covers/${last4.slice(0,2)}/${last4.slice(2)}/${c}.jpg`;
}
function mcProbeImage(url,timeout=4500){
  return new Promise(resolve=>{
    if(!url)return resolve('');
    const im=new Image();let done=false;
    const finish=v=>{if(done)return;done=true;clearTimeout(t);im.onload=im.onerror=null;resolve(v?url:'')};
    const t=setTimeout(()=>finish(false),timeout);
    im.onload=()=>finish((im.naturalWidth||0)>40&&(im.naturalHeight||0)>40);
    im.onerror=()=>finish(false);
    im.referrerPolicy='no-referrer';im.src=url+(url.includes('?')?'&':'?')+'mc='+Date.now();
  });
}
async function mcResolveCoverFromIsbn(isbn){
  const code=mcIsbnDigits(isbn);if(!code)return'';
  try{
    const k='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(k)+'&format=json&jscmd=data',{cache:'no-store'}),j=await r.json(),b=j[k];
    const u=b?.cover?.large||b?.cover?.medium||b?.cover?.small||'';if(u&&await mcProbeImage(u))return u;
  }catch{}
  try{
    const r=await fetch('https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent('isbn:'+code)+'&maxResults=5',{cache:'no-store'});if(r.ok){const j=await r.json();for(const it of j.items||[]){const v=it.volumeInfo||{};let u=v.imageLinks?.extraLarge||v.imageLinks?.large||v.imageLinks?.medium||v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||'';u=String(u).replace(/^http:/,'https:');if(u&&await mcProbeImage(u))return u}}
  }catch{}
  const ol='https://covers.openlibrary.org/b/isbn/'+encodeURIComponent(code)+'-L.jpg?default=false';if(await mcProbeImage(ol))return ol;
  const db=mcIsbnDbCover(code);if(db&&await mcProbeImage(db))return db;
  return'';
}

function mcCandidateMinimalOk(x,c){
  const d=c?.data||{},wanted=String(x.issueNr??x.issue??'').trim();
  if(wanted&&d.issueNr&&typeof mcIssueExact==='function'&&!mcIssueExact(wanted,d.issueNr))return false;
  if(!d.coverUrl)return false;
  return !!(d.title||d.series||d.publisher||d.isbn);
}

async function mcTebeosferaLocalLoose(x){
  const rows=await allStore('master'),wanted=String(x.issueNr??x.issue??'').trim(),q=norm(x.catalogHeader||x.series||''),out=[];
  for(const r of rows){
    const src=(String(r.source||'')+' '+String(r.sourceUrl||'')).toLowerCase();if(!src.includes('tebeosfera'))continue;
    const ri=String(r.issueNr??r.issue??'').trim();if(wanted&&ri&&typeof mcIssueExact==='function'&&!mcIssueExact(wanted,ri))continue;
    const rs=norm(r.catalogHeader||r.series||'');if(q&&rs&&!rs.includes(q)&&!q.includes(rs))continue;
    let cover=r.coverUrl||'';if(!cover&&r.isbn)cover=await mcResolveCoverFromIsbn(r.isbn);
    out.push({source:'Tebeosfera',data:{title:r.title||'',publisher:r.publisher||'',publicationDate:r.publicationDate||'',pages:r.pages||'',isbn:r.isbn||'',coverUrl:cover,volume:r.volume||'',series:r.catalogHeader||r.series||'',issueNr:ri||wanted,startYear:r.startYear||'',format:r.format||'',writer:r.authors?.writer||r.writer||'',artist:r.authors?.artist||r.artist||'',inker:r.authors?.inker||r.inker||'',colorist:r.authors?.colorist||r.colorist||'',externalId:r.sourceId||r.externalId||''},_score:5000});
  }
  return out;
}

async function mcGcdLooseCandidates(x){
  const wanted=String(x.issueNr??x.issue??'').trim();if(!wanted)return[];
  const names=(typeof mcSearchNameVariants==='function'?mcSearchNameVariants(x):[x.catalogHeader||x.series]).filter(Boolean),out=[],seen=new Set();
  for(const name of names.slice(0,10)){
    try{
      const r=await fetch('https://www.comics.org/api/series/name/'+encodeURIComponent(name)+'/issue/'+encodeURIComponent(wanted)+'/',{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok)continue;
      const j=await r.json(),arr=Array.isArray(j)?j:(j.results||[]);
      for(const it of arr.slice(0,20)){
        const d=await mcFetchIssueDetail(it),actual=String(d.number??'').trim();
        if(actual&&typeof mcIssueExact==='function'&&!mcIssueExact(wanted,actual))continue;
        const key=d.api_url||JSON.stringify([d.series_name,actual,d.publication_date]);if(seen.has(key))continue;seen.add(key);
        const stories=d.story_set||[],isbn=d.isbn||d.barcode||'';let cover=d.cover||'';if(!cover&&isbn)cover=await mcResolveCoverFromIsbn(isbn);
        out.push({source:'Grand Comics Database',data:{title:d.title||d.descriptor||'',publisher:typeof d.indicia_publisher==='string'?d.indicia_publisher:(x.publisher||''),publicationDate:mcNormalizeDate(d.publication_date),pages:d.page_count||'',isbn,coverUrl:cover,volume:d.volume||'',series:d.series_name||name,issueNr:actual||wanted,startYear:x.startYear||'',format:d.binding||'',writer:stories.map(s=>s.script).filter(Boolean).join(', '),artist:stories.map(s=>s.pencils).filter(Boolean).join(', '),inker:stories.map(s=>s.inks).filter(Boolean).join(', '),colorist:stories.map(s=>s.colors).filter(Boolean).join(', '),externalId:String(d.api_url||'')},_score:2000});
      }
    }catch{}
  }
  return out;
}

async function mcOpenLibraryLoose(x){
  const out=[],wanted=String(x.issueNr??x.issue??'').trim(),code=mcIsbnDigits(x.isbn||''),title=x.title||x.catalogHeader||x.series||'';
  if(code){
    try{const k='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(k)+'&format=json&jscmd=data',{cache:'no-store'}),j=await r.json(),b=j[k];if(b){let cover=b.cover?.large||b.cover?.medium||'';if(!cover)cover=await mcResolveCoverFromIsbn(code);out.push({source:'Open Library · código',data:{title:b.title||'',pages:b.number_of_pages||'',publisher:b.publishers?.[0]?.name||x.publisher||'',publicationDate:mcNormalizeDate(b.publish_date),isbn:code,coverUrl:cover,writer:(b.authors||[]).map(a=>a.name).filter(Boolean).join(', '),series:x.catalogHeader||x.series||'',issueNr:wanted},_score:1800})}}catch{}
  }
  if(title){
    try{const u='https://openlibrary.org/search.json?title='+encodeURIComponent(title)+(x.publisher?'&publisher='+encodeURIComponent(x.publisher):'')+'&limit=15',r=await fetch(u,{cache:'no-store'}),j=await r.json();for(const d of j.docs||[]){let cover=d.cover_i?'https://covers.openlibrary.org/b/id/'+d.cover_i+'-L.jpg':'';if(!cover&&(d.isbn||[])[0])cover=await mcResolveCoverFromIsbn((d.isbn||[])[0]);if(cover)out.push({source:'Open Library · datos',data:{title:d.title||'',publisher:(d.publisher||[])[0]||'',publicationDate:d.first_publish_year?d.first_publish_year+'-01-01':'',isbn:(d.isbn||[])[0]||'',coverUrl:cover,writer:(d.author_name||[]).join(', '),series:x.catalogHeader||x.series||'',issueNr:wanted},_score:900})}}catch{}
  }
  return out;
}

mcCollectCompleteCandidates=async function(x){
  const pool=[],seen=new Set();
  const add=c=>{if(!c||!mcCandidateMinimalOk(x,c))return;const d=c.data||{},k=[mcIsbnDigits(d.isbn),norm(d.series||''),String(d.issueNr||''),d.coverUrl].join('|');if(seen.has(k))return;seen.add(k);pool.push(c)};
  for(const c of await mcTebeosferaLocalLoose(x))add(c);
  for(const c of await mcGcdLooseCandidates(x))add(c);
  for(const c of await mcOpenLibraryLoose(x))add(c);
  pool.sort((a,b)=>Number(b._score||0)-Number(a._score||0));
  return pool.slice(0,12);
};

mcNoCompleteResult=function(x,quick=false){return `<div class="notice"><b>No he encontrado todavía una portada válida para este número.</b><br>He vuelto al buscador más permisivo: primero intenta Tebeosfera del Maestro, después GCD y por último ISBN/Open Library. No se mostrarán números distintos como sustitutos.</div><div class="result-actions" style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn" type="button" onclick="${quick?'mcCancelSeriesQuick()':'mcCancelUnified()'}">Cancelar</button></div>`};

(function(){const put=()=>{const el=document.getElementById('mc-build-badge');if(el)el.textContent='MI COMICOTECA '+MC_BUILD_V28};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',put);else put();})();
