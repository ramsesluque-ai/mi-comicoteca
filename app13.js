'use strict';
/* v19: búsqueda estricta por número de ejemplar + resultados Aceptar/Cancelar */
let mcUnifiedSelected=0;

function mcIssueNorm(v){
  return String(v??'').trim().toLowerCase().replace(/\s+/g,'').replace(',','.').replace(/^0+(?=\d)/,'');
}
function mcIssueExact(wanted,actual){
  if(!String(wanted??'').trim())return true;
  return mcIssueNorm(wanted)===mcIssueNorm(actual);
}
function mcYearFrom(v){const m=String(v||'').match(/(18|19|20)\d{2}/);return m?m[0]:''}
function mcCandidateScore(c,x,code){
  const d=c.data||{};let s=0;
  if(code&&String(d.isbn||'').replace(/[^0-9A-Za-z]/g,'')===code)s+=1000;
  if(x.issueNr!==''&&mcIssueExact(x.issueNr,d.issueNr))s+=500;
  const qs=norm(x.catalogHeader||x.series),ds=norm(d.series||'');
  if(qs&&ds){if(qs===ds)s+=220;else if(ds.includes(qs)||qs.includes(ds))s+=120}
  const qp=norm(x.publisher),dp=norm(d.publisher);
  if(qp&&dp){if(qp===dp)s+=140;else if(dp.includes(qp)||qp.includes(dp))s+=70}
  const qy=String(x.startYear||''),dy=String(d.startYear||mcYearFrom(d.publicationDate)||'');
  if(qy&&dy&&qy===dy)s+=80;
  return s;
}

mcSearchFichaAll=async function(){
  const x=mcFormComic(),series=x.catalogHeader||x.series,title=x.title||'',wantedIssue=String(x.issueNr??'').trim(),code=String(x.isbn||'').replace(/[^0-9A-Za-z]/g,'');
  if(!code&&!series&&!title)return toast('Informa un código, cabecera/serie o título para buscar');
  mcUnifiedCandidates=[];mcUnifiedSelected=0;
  mcShowSearch('Buscar datos y portada',`<div class="muted">Buscando ${wantedIssue?`${esc(series)} · nº ${esc(wantedIssue)}`:'por los datos de la ficha'}…</div>`);
  try{
    /* Un código exacto tiene prioridad porque identifica la edición aunque la fuente no informe el número. */
    if(code){
      try{
        const k='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(k)+'&format=json&jscmd=data'),j=await r.json(),b=j[k];
        if(b)mcAddUnified('Open Library · código',{title:b.title||'',pages:b.number_of_pages||'',publisher:b.publishers?.[0]?.name||'',publicationDate:mcNormalizeDate(b.publish_date),isbn:code,coverUrl:b.cover?.large||b.cover?.medium||'',writer:(b.authors||[]).map(a=>a.name).filter(Boolean).join(', '),series:series||'',issueNr:wantedIssue||'',_exactCode:true});
      }catch{}
    }

    /* Con número informado, GCD se consulta por Serie + Número (+ Año). Solo aceptamos coincidencia exacta del número. */
    if(series&&wantedIssue!==''){
      let u='https://www.comics.org/api/series/name/'+encodeURIComponent(series)+'/issue/'+encodeURIComponent(wantedIssue)+'/';
      if(x.startYear)u+='year/'+encodeURIComponent(x.startYear)+'/';
      try{
        const r=await fetch(u,{headers:{Accept:'application/json'}});
        if(r.ok){
          const j=await r.json(),a=Array.isArray(j)?j:(j.results||[]);
          for(const it of a.slice(0,20)){
            const d=await mcFetchIssueDetail(it),actual=d.number??it.number??'';
            if(!mcIssueExact(wantedIssue,actual))continue;
            const stories=d.story_set||[];
            mcAddUnified('Grand Comics Database',{title:d.title||d.descriptor||'',publisher:typeof d.indicia_publisher==='string'?d.indicia_publisher:'',publicationDate:mcNormalizeDate(d.publication_date),pages:d.page_count||'',isbn:d.isbn||d.barcode||code||'',coverUrl:d.cover||'',volume:d.volume||'',series:d.series_name||series,issueNr:actual,startYear:x.startYear||mcYearFrom(d.publication_date),format:d.binding||'',writer:stories.map(s=>s.script).filter(Boolean).join(', '),artist:stories.map(s=>s.pencils).filter(Boolean).join(', '),inker:stories.map(s=>s.inks).filter(Boolean).join(', '),colorist:stories.map(s=>s.colors).filter(Boolean).join(', '),externalId:String(d.api_url||'')});
          }
        }
      }catch{}
    }

    /* Open Library por título es útil para libros/tomos, pero no identifica con fiabilidad números de una serie. */
    if(!wantedIssue&&(title||series)){
      try{
        const q=title||series,u='https://openlibrary.org/search.json?title='+encodeURIComponent(q)+(x.publisher?'&publisher='+encodeURIComponent(x.publisher):'')+'&limit=8',r=await fetch(u),j=await r.json();
        for(const d of (j.docs||[]).slice(0,8))mcAddUnified('Open Library · datos',{title:d.title||'',publisher:(d.publisher||[])[0]||'',publicationDate:d.first_publish_year?`${d.first_publish_year}-01-01`:'',isbn:(d.isbn||[])[0]||'',coverUrl:d.cover_i?'https://covers.openlibrary.org/b/id/'+d.cover_i+'-L.jpg':'',writer:(d.author_name||[]).join(', '),series:series||'',issueNr:''});
      }catch{}
    }

    /* Si existe número, descartamos cualquier candidato genérico sin número salvo un código exacto. */
    if(wantedIssue)mcUnifiedCandidates=mcUnifiedCandidates.filter(c=>c.data?._exactCode||mcIssueExact(wantedIssue,c.data?.issueNr));
    mcUnifiedCandidates.sort((a,b)=>mcCandidateScore(b,x,code)-mcCandidateScore(a,x,code));
    mcUnifiedSelected=0;
    mcRenderUnifiedResults();
  }catch(e){mcShowSearch('Buscar datos y portada',`<div class="notice">No se pudo completar la búsqueda: ${esc(e.message||e)}</div>`)}
};

function mcSelectUnified(i){
  mcUnifiedSelected=i;
  document.querySelectorAll('#mcFichaSearchBox .unified-result').forEach((el,n)=>el.classList.toggle('selected',n===i));
  document.querySelectorAll('#mcFichaSearchBox input[name="mcUnifiedPick"]').forEach((el,n)=>el.checked=n===i);
}

mcRenderUnifiedResults=function(){
  const x=mcFormComic(),wantedIssue=String(x.issueNr??'').trim();
  if(!mcUnifiedCandidates.length){
    mcShowSearch('Resultados: datos y portada',`<div class="notice">No se encontró una coincidencia fiable${wantedIssue?` para <b>${esc(x.catalogHeader||x.series)} nº ${esc(wantedIssue)}</b>`:''}. No se mostrarán números distintos como sustitutos.</div><div class="result-actions" style="margin-top:12px"><button class="btn" type="button" onclick="mcCancelUnified()">Cancelar</button></div>`);
    return;
  }
  const cards=mcUnifiedCandidates.map((c,i)=>{const d=c.data||{};return `<article class="ficha-result unified-result ${i===mcUnifiedSelected?'selected':''}" onclick="mcSelectUnified(${i})" style="cursor:pointer"><div class="result-pick"><input type="radio" name="mcUnifiedPick" ${i===mcUnifiedSelected?'checked':''} onclick="event.stopPropagation();mcSelectUnified(${i})"></div>${d.coverUrl?`<img src="${esc(d.coverUrl)}" referrerpolicy="no-referrer" loading="lazy">`:'<div class="result-no-cover">Sin portada</div>'}<div><span class="source-pill">${esc(c.source)}</span><b>${esc(d.title||d.series||'Resultado')}</b><div class="small muted">${esc([d.publisher,d.series,d.issueNr!==''&&d.issueNr!==undefined?('Nº '+d.issueNr):'',d.publicationDate,d.isbn&&('Código '+d.isbn)].filter(Boolean).join(' · '))}</div></div></article>`}).join('');
  const html=`<div class="ficha-result-grid unified-results">${cards}</div><div class="result-actions" style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px"><button class="btn" type="button" onclick="mcCancelUnified()">Cancelar</button><button class="btn primary" type="button" onclick="mcAcceptUnified()">Aceptar</button></div>`;
  mcShowSearch('Resultados: datos y portada',html);
};

async function mcAcceptUnified(){
  const c=mcUnifiedCandidates[mcUnifiedSelected];if(!c)return toast('Selecciona un resultado');
  const d=c.data||{};
  await mcApplyUnified(mcUnifiedSelected,!!d.coverUrl);
  const box=document.getElementById('mcFichaSearchBox');if(box)box.classList.add('hidden');
}
function mcCancelUnified(){
  mcUnifiedCandidates=[];mcUnifiedSelected=0;
  const box=document.getElementById('mcFichaSearchBox');if(box)box.classList.add('hidden');
}
