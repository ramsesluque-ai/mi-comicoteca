'use strict';
/* MI COMICOTECA - puente gratuito de búsqueda mediante GitHub Actions.
   Usa la misma credencial de Contents: Read/Write ya configurada para sincronización. */
(function(){
  const OWNER='ramsesluque-ai',REPO='mi-comicoteca',BRANCH='bridge-data';
  const TOKEN_KEY='mc_github_token_v1';
  const RAW=`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/bridge`;
  const API=`https://api.github.com/repos/${OWNER}/${REPO}/contents`;
  const enc=new TextEncoder();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const b64=s=>{const u=enc.encode(s);let out='';for(let i=0;i<u.length;i+=0x8000)out+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(out)};
  const token=()=>localStorage.getItem(TOKEN_KEY)||'';
  const clean=s=>String(s??'').trim();
  async function sha1(text){const d=new Uint8Array(await crypto.subtle.digest('SHA-1',enc.encode(text)));return [...d].map(b=>b.toString(16).padStart(2,'0')).join('')}
  function issue(v){const s=clean(v).replace(/^0+(?=\d)/,'');return s||'0'}
  async function ids(x){
    const stable=[clean(x.publisher),clean(x.catalogHeader||x.series),clean(x.stage),clean(x.startYear),issue(x.issueNr??x.issue),String(x.isbn||'').replace(/[^0-9Xx]/g,'')].join('|').toLowerCase();
    const cacheKey=(await sha1(stable)).slice(0,24);
    const requestId=cacheKey+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
    return {cacheKey,requestId};
  }
  async function rawJson(path){
    try{const r=await fetch(`${RAW}/${path}?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)return null;return await r.json()}catch{return null}
  }
  async function putRequest(path,obj){
    const t=token();if(!t)throw Error('Falta la credencial GitHub de escritura. Ábrela desde Sincronizar y pulsa Probar escritura.');
    const u=`${API}/${path}`;
    const body={message:'Solicita búsqueda bibliográfica MI COMICOTECA',content:b64(JSON.stringify(obj,null,2)),branch:BRANCH};
    const r=await fetch(u,{method:'PUT',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+t,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok){let m='';try{m=(await r.json()).message||''}catch{}throw Error(`No se pudo lanzar la búsqueda en GitHub (${r.status})${m?': '+m:''}`)}
  }
  function convert(payload){
    const rows=Array.isArray(payload?.candidates)?payload.candidates:[];
    return rows.map(c=>({source:c.source||'Puente bibliográfico',score:Number(c.score||5000),data:{...(c.data||{})}})).filter(c=>c.data?.coverUrl);
  }
  async function search(x,onStatus){
    const {cacheKey,requestId}=await ids(x);
    const cached=await rawJson(`cache/${cacheKey}.json`);
    if(cached?.candidates?.length){onStatus?.('Resultado bibliográfico recuperado de la caché.');return convert(cached)}
    onStatus?.('Consultando Tebeosfera y fuentes bibliográficas desde el servidor…');
    const req={requestId,cacheKey,publisher:clean(x.publisher),series:clean(x.catalogHeader||x.series),stage:clean(x.stage),startYear:clean(x.startYear),issue:issue(x.issueNr??x.issue),isbn:String(x.isbn||'').replace(/[^0-9Xx]/g,'')};
    await putRequest(`bridge/requests/${requestId}.json`,req);
    for(let i=0;i<48;i++){
      await sleep(i<4?2500:3500);
      const result=await rawJson(`results/${requestId}.json`);
      if(result){onStatus?.(result.ok?'Datos y portada encontrados.':'La búsqueda terminó sin coincidencia completa.');return convert(result)}
    }
    throw Error('La búsqueda del servidor sigue pendiente. Vuelve a pulsar Buscar para recoger el resultado cuando esté disponible.');
  }
  window.MCBridgeSearch={search,rawJson};

  if(typeof window.mcSESearch==='function'){
    const browserSearch=window.mcSESearch;
    window.mcSESearch=async function(x){
      try{
        const rows=await search(x,t=>{
          try{
            if(document.getElementById('mcFichaSearchBox'))mcShowSearch('Buscar datos y portada',`<div class="muted">${esc(t)}</div>`);
            if(document.getElementById('mcSeriesQuickPanel'))mcSeriesQuickPanel(`<div class="muted">${esc(t)}</div>`);
          }catch{}
        });
        if(rows.length)return rows;
      }catch(e){console.warn('Bridge search:',e);}
      /* Caché/local como respaldo; las APIs con CORS pueden fallar pero no bloquean la app. */
      return browserSearch(x);
    };
  }
})();
