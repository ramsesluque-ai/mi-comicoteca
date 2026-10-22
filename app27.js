'use strict';
/* v38: fallback seguro de portadas. Maestro -> bridge cache -> ISBN abierto; búsqueda manual puede activar bridge externo. */
(function(){
  if(typeof window.mcSESearch!=='function')return;
  const BASE_SEARCH=window.mcSESearch;
  const OWNER='ramsesluque-ai',REPO='mi-comicoteca',BRANCH='bridge-data',TOKEN_KEY='mc_github_token_v1';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const code=v=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const issue=v=>typeof mcSEIssue==='function'?mcSEIssue(v):String(v??'').trim();
  const slug=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'sin-dato';
  const b64text=s=>{const u=new TextEncoder().encode(s);let out='';for(let i=0;i<u.length;i+=0x8000)out+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(out)};

  async function dataOnly(x){
    const [local,master]=await Promise.all([mcSELocalOverlay(x).catch(()=>[]),mcSEStaticMaster(x).catch(()=>[])]),all=[...local,...master],seen=new Set(),out=[];
    for(const c of all.sort((a,b)=>Number(b.score||0)-Number(a.score||0))){
      if(!mcSEValid(x,c,false))continue;
      const k=mcSECandidateKey(c);if(seen.has(k))continue;seen.add(k);out.push(c);
    }
    return out.slice(0,12);
  }

  function requestId(x,c){
    const d=c?.data||{},pub=x.publisher||d.publisher||'',series=x.catalogHeader||x.series||d.series||'',n=issue(x.issueNr??x.issue??d.issueNr??''),isbn=code(x.isbn||d.isbn||'');
    return ['auto',slug(pub),slug(series),slug(n||'sin-numero'),isbn||'sin-isbn'].join('-').slice(0,170);
  }
  function bridgeRaw(id){return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/bridge/results/${encodeURIComponent(id)}.json`}
  async function readBridge(id,x){
    try{
      const r=await fetch(bridgeRaw(id)+'?t='+Date.now(),{cache:'no-store'});if(!r.ok)return[];const j=await r.json(),out=[];
      for(const c of j.candidates||[]){
        const d=c?.data||{},urls=mcSEMergeCovers(d.coverUrls||[],d.coverUrl||'');
        const cc=mcSECandidate('Bridge · '+(c.source||'fuente externa'),{...d,coverUrl:urls[0]||'',coverUrls:urls},Number(c.score||0)+3000,urls);
        if(mcSEValid(x,cc,true))out.push(cc);
      }
      return out.sort((a,b)=>Number(b.score||0)-Number(a.score||0));
    }catch{return[]}
  }
  async function cachedBridge(x,rows){
    const ids=[...new Set([...(rows||[]).map(c=>requestId(x,c)),requestId(x,null)])];
    for(const id of ids){const a=await readBridge(id,x);if(a.length)return a}
    return[];
  }

  async function coverByISBN(isbn){
    const k=code(isbn);if(!k)return'';
    try{
      const key='ISBN:'+k,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(key)+'&format=json&jscmd=data',{cache:'no-store'}),j=await r.json(),b=j[key];
      const u=String(b?.cover?.large||b?.cover?.medium||b?.cover?.small||'').replace(/^http:/,'https:');if(u)return u;
    }catch{}
    try{
      const r=await fetch('https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent('isbn:'+k)+'&maxResults=10',{cache:'no-store'}),j=await r.json();
      for(const it of j.items||[]){
        const v=it.volumeInfo||{},ids=v.industryIdentifiers||[],exact=ids.some(z=>code(z.identifier)===k);if(!exact)continue;
        const u=String(v.imageLinks?.extraLarge||v.imageLinks?.large||v.imageLinks?.medium||v.imageLinks?.small||v.imageLinks?.thumbnail||'').replace(/^http:/,'https:');if(u)return u;
      }
    }catch{}
    return'';
  }
  async function openISBN(x,rows){
    const out=[];
    for(const c of (rows||[]).slice(0,8)){
      const d=c?.data||{},isbn=code(d.isbn||x.isbn||'');if(!isbn)continue;
      const cover=await coverByISBN(isbn);if(!cover)continue;
      try{if(window.CoverVault?.fetchAndCompress)await window.CoverVault.fetchAndCompress(cover)}catch{continue}
      const cc=mcSECandidate((c.source||'Maestro España')+' · portada por ISBN',{...d,coverUrl:cover,coverUrls:[cover]},Number(c.score||0)+2400,[cover]);
      if(mcSEValid(x,cc,true))out.push(cc);
    }
    return out.sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  }

  async function triggerBridge(x,rows){
    const token=localStorage.getItem(TOKEN_KEY)||'';if(!token)return[];
    const c=(rows||[])[0],d=c?.data||{},id=requestId(x,c),cached=await readBridge(id,x);if(cached.length)return cached;
    const req={requestId:id,cacheKey:id,publisher:x.publisher||d.publisher||'',series:x.catalogHeader||x.series||d.series||'',stage:x.stage||d.stage||'',startYear:String(x.startYear||d.startYear||''),issue:String(x.issueNr??x.issue??d.issueNr??''),isbn:code(x.isbn||d.isbn||''),requestedAt:new Date().toISOString()};
    const api=`https://api.github.com/repos/${OWNER}/${REPO}/contents/bridge/requests/${encodeURIComponent(id)}.json`,headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
    let sha='';
    try{const g=await fetch(api+'?ref='+encodeURIComponent(BRANCH),{headers,cache:'no-store'});if(g.ok)sha=(await g.json()).sha||''}catch{}
    const body={message:'Busca portada '+id,content:b64text(JSON.stringify(req,null,2)),branch:BRANCH};if(sha)body.sha=sha;
    const put=await fetch(api,{method:'PUT',headers,body:JSON.stringify(body)});if(!put.ok)return[];
    const started=Date.now();
    for(let i=0;i<28;i++){
      await sleep(2200);
      try{
        const r=await fetch(bridgeRaw(id)+'?t='+Date.now(),{cache:'no-store'});if(!r.ok)continue;const j=await r.json(),when=Date.parse(j.generatedAt||0)||0;if(when&&when<started-5000)continue;
        const a=[];for(const c2 of j.candidates||[]){const dd=c2?.data||{},urls=mcSEMergeCovers(dd.coverUrls||[],dd.coverUrl||''),cc=mcSECandidate('Bridge · '+(c2.source||'fuente externa'),{...dd,coverUrl:urls[0]||'',coverUrls:urls},Number(c2.score||0)+3000,urls);if(mcSEValid(x,cc,true))a.push(cc)}
        if(a.length)return a.sort((a,b)=>Number(b.score||0)-Number(a.score||0));
        if(j.ok)return[];
      }catch{}
    }
    return[];
  }

  window.mcSESearch=async function(x){
    const base=await BASE_SEARCH(x);if(base.length)return base;
    const rows=await dataOnly(x);if(rows.length)MCSearch.lastDataOnly=Math.max(Number(MCSearch.lastDataOnly||0),rows.length);
    const cached=await cachedBridge(x,rows);if(cached.length)return cached.slice(0,10);
    const isbn=await openISBN(x,rows);if(isbn.length)return isbn.slice(0,10);
    return[];
  };

  window.mcSearchFichaAll=async function(){
    const x=mcFormComic();
    if(!issue(x.issueNr??x.issue??'')&&!code(x.isbn||''))return toast('Informa al menos el número de la serie o un ISBN/EAN');
    MCSearch.ficha=[];MCSearch.selectedFicha=0;MCSearch.lastDataOnly=0;
    mcShowSearch('Buscar datos y portada',`<div class="muted">Consultando Maestro España: ${esc(x.catalogHeader||x.series||'')} · nº ${esc(x.issueNr||x.issue||'')}…</div>`);
    try{
      let list=await BASE_SEARCH(x),rows=[];
      if(!list.length){rows=await dataOnly(x);if(rows.length)MCSearch.lastDataOnly=rows.length;list=await cachedBridge(x,rows)}
      if(!list.length&&localStorage.getItem(TOKEN_KEY)){
        mcShowSearch('Buscar datos y portada',`<div class="muted">Ficha identificada. Buscando una portada verificada en Tebeosfera y fuentes externas…</div>`);
        list=await triggerBridge(x,rows);
      }
      if(!list.length){list=await openISBN(x,rows)}
      MCSearch.ficha=list||[];
      if(!MCSearch.ficha.length){
        const ext=localStorage.getItem(TOKEN_KEY)?'La búsqueda externa tampoco ha devuelto una portada suficientemente segura.':'Puedes seguir usando la ficha bibliográfica; para lanzar búsquedas externas nuevas desde este dispositivo, activa la credencial de escritura en Sincronizar.';
        return mcShowSearch('Resultados: datos y portada',mcSEEmpty(x)+`<div class="notice" style="margin-top:12px"><span class="muted">${esc(ext)}</span></div><div class="result-actions"><button class="btn" onclick="mcCancelUnified()">Cancelar</button></div>`);
      }
      mcShowSearch('Resultados: datos y portada',mcSERenderCards(MCSearch.ficha,0,'mcSESelectFicha')+`<div class="result-actions"><button class="btn" onclick="mcCancelUnified()">Cancelar</button><button class="btn primary" onclick="mcAcceptUnified()">Aceptar</button></div>`);
    }catch(e){console.error(e);mcShowSearch('Resultados',`<div class="notice"><b>No se pudo completar la búsqueda.</b><br>${esc(e.message||e)}</div><div class="result-actions"><button class="btn" onclick="mcCancelUnified()">Cancelar</button></div>`)}
  };
  window.mcSearchFichaData=window.mcSearchFichaAll;window.mcSearchFichaCover=window.mcSearchFichaAll;window.mcCompleteByCode=async function(){await window.mcSearchFichaAll()};
})();
