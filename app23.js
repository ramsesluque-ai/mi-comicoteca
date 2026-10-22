'use strict';
/* v29: el número real del resultado manda. Open Library ya no hereda el número buscado. */
const MC_BUILD_V29='v29';

function mcExtractIssueNumber(text){
  const t=String(text||'').replace(/\u00a0/g,' ').trim();
  const patterns=[
    /(?:núm(?:ero)?|num(?:ero)?|n[º°o]\.?|#)\s*0*(\d{1,4})(?!\d)/i,
    /(?:issue|number)\s*#?\s*0*(\d{1,4})(?!\d)/i
  ];
  for(const re of patterns){const m=t.match(re);if(m)return String(parseInt(m[1],10))}
  return'';
}
function mcWantedIssue(x){const v=String(x?.issueNr??x?.issue??'').trim();return /^0*\d+$/.test(v)?String(parseInt(v,10)):v}
function mcIssueTitleExact(title,wanted){
  if(!wanted)return true;
  const got=mcExtractIssueNumber(title);
  return !!got && (typeof mcIssueExact==='function'?mcIssueExact(wanted,got):String(wanted)===String(got));
}
function mcOlQueryVariants(x){
  const series=String(x.catalogHeader||x.series||'').trim(),wanted=mcWantedIssue(x),pub=String(x.publisher||'').trim();
  if(!series)return[];
  const nums=[wanted,wanted&&wanted.padStart(2,'0')].filter(Boolean),q=[];
  const add=s=>{if(s&&!q.includes(s))q.push(s)};
  for(const n of nums){
    add(`${series} núm. ${n}`);
    add(`${series} nº ${n}`);
    add(`${series} num. ${n}`);
    if(pub)add(`${series} núm. ${n} ${pub}`);
  }
  return q.slice(0,6);
}

mcOpenLibraryLoose=async function(x){
  const out=[],wanted=mcWantedIssue(x),code=mcIsbnDigits(x.isbn||''),seen=new Set();
  const add=async(d,source,exactCode=false)=>{
    const title=String(d.title||'');
    let issue='';
    if(exactCode){issue=wanted||mcExtractIssueNumber(title)}
    else {
      issue=mcExtractIssueNumber(title);
      if(wanted&&(!issue||!(typeof mcIssueExact==='function'?mcIssueExact(wanted,issue):String(wanted)===String(issue))))return;
    }
    let isbn=(d.isbn||[])[0]||d._isbn||'';
    let cover=d.cover_i?'https://covers.openlibrary.org/b/id/'+d.cover_i+'-L.jpg':(d._cover||'');
    if(!cover&&isbn)cover=await mcResolveCoverFromIsbn(isbn);
    if(!cover)return;
    const k=[mcIsbnDigits(isbn),norm(title),issue,cover].join('|');if(seen.has(k))return;seen.add(k);
    out.push({source,data:{title,publisher:(d.publisher||[])[0]||d._publisher||x.publisher||'',publicationDate:d.first_publish_year?d.first_publish_year+'-01-01':(d._date||''),pages:d.number_of_pages_median||d._pages||'',isbn,coverUrl:cover,writer:(d.author_name||d._authors||[]).join(', '),series:x.catalogHeader||x.series||'',issueNr:issue||wanted},_score:exactCode?2200:1400});
  };
  if(code){
    try{
      const k='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(k)+'&format=json&jscmd=data',{cache:'no-store'}),j=await r.json(),b=j[k];
      if(b)await add({title:b.title||'',publisher:(b.publishers||[]).map(z=>z.name),_date:mcNormalizeDate(b.publish_date),_pages:b.number_of_pages||'',_isbn:code,_cover:b.cover?.large||b.cover?.medium||'',_authors:(b.authors||[]).map(a=>a.name).filter(Boolean)},'Open Library · código',true);
    }catch{}
  }
  for(const q of mcOlQueryVariants(x)){
    try{
      const u='https://openlibrary.org/search.json?q='+encodeURIComponent(q)+'&limit=50&language=spa';
      const r=await fetch(u,{cache:'no-store'});if(!r.ok)continue;const j=await r.json();
      for(const d of j.docs||[])await add(d,'Open Library · nº exacto',false);
    }catch{}
    if(out.length>=8)break;
  }
  return out;
};

/* Última barrera: ningún resultado de una búsqueda numerada puede llegar a pantalla con otro número. */
const mcCollectCompleteCandidatesV28=mcCollectCompleteCandidates;
mcCollectCompleteCandidates=async function(x){
  const wanted=mcWantedIssue(x),a=await mcCollectCompleteCandidatesV28(x);
  const filtered=a.filter(c=>{
    if(!wanted)return true;
    const d=c?.data||{},actual=String(d.issueNr||'').trim();
    return !!actual && (typeof mcIssueExact==='function'?mcIssueExact(wanted,actual):String(wanted)===actual);
  });
  filtered.sort((a,b)=>Number(b._score||0)-Number(a._score||0));
  return filtered.slice(0,12);
};

(function(){const put=()=>{const el=document.getElementById('mc-build-badge');if(el)el.textContent='MI COMICOTECA '+MC_BUILD_V29};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',put);else put();})();
