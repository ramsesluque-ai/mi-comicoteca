'use strict';
/* v20: navegación persistente dentro de Colecciones + búsqueda rápida por número */
let mcSeriesReturnEncoded='',mcEditingFromSeries=false,mcSeriesScrollTop=0;
let mcSeriesQuickCandidates=[],mcSeriesQuickSelected=0,mcSeriesQuickId='';

const mcCloseModalBase=closeModal;
closeModal=function(){
  if(mcEditingFromSeries&&mcSeriesReturnEncoded){
    const enc=mcSeriesReturnEncoded,scroll=mcSeriesScrollTop;
    mcEditingFromSeries=false;
    mcCloseModalBase();
    setTimeout(async()=>{await openSeries(enc);const b=$('#modal .modalbody');if(b)b.scrollTop=scroll},0);
    return;
  }
  mcCloseModalBase();
};

function mcCloseSeries(){mcEditingFromSeries=false;mcSeriesReturnEncoded='';mcSeriesScrollTop=0;mcCloseModalBase()}
function mcRememberSeriesScroll(){mcSeriesScrollTop=$('#modal .modalbody')?.scrollTop||0}
async function mcEditFromSeries(id,encoded){mcRememberSeriesScroll();mcSeriesReturnEncoded=encoded;mcEditingFromSeries=true;await editComic(id)}

openSeries=async function(encoded){
  const k=decodeURIComponent(encoded),r=(await allStore('comics')).filter(x=>ckey(x)===k).sort((a,b)=>typeof mcIssueCmp==='function'?mcIssueCmp(a,b):num(a.issueNr)-num(b.issueNr)),sample=r[0];
  mcSeriesReturnEncoded=encoded;mcEditingFromSeries=false;
  if(!sample){toast('Esta colección ya no tiene registros');return mcCloseSeries()}
  $('#modal').innerHTML=`<div class="modalbox"><div class="modalhead"><div><b>${esc(clabel(sample))}</b><div class="muted small">${r.filter(x=>x.status==='In Collection').length} en colección · ${r.filter(x=>x.status==='On Wish List').length} wishlist · ${r.length} registros</div></div><button class="btn" onclick="mcCloseSeries()">Cerrar</button></div><div class="modalbody"><div class="issue-grid">${r.map(x=>`<article class="issue-card"><div onclick="mcEditFromSeries('${esc(x.id)}','${esc(encoded)}')" style="cursor:pointer">${img(x,'cover issuecover')}</div><div class="issue-body"><div class="issue-no">#${esc(x.issueNr||x.issue||'—')}</div><div class="issue-title" onclick="mcEditFromSeries('${esc(x.id)}','${esc(encoded)}')" style="cursor:pointer">${esc(x.title||x.subtitle||'Sin título')}</div><div>${statusPill(x.status)}</div><div class="issue-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px"><button class="btn sm" type="button" onclick="mcEditFromSeries('${esc(x.id)}','${esc(encoded)}')">Editar</button><button class="btn sm primary" type="button" onclick="mcQuickSearchSeriesIssue('${esc(x.id)}','${esc(encoded)}',event)">⌕ Buscar datos y portada</button></div></div></article>`).join('')}</div></div></div>`;
  $('#modal').classList.remove('hidden');
  CoverVault?.hydrate?.();
  if(mcSeriesScrollTop){const b=$('#modal .modalbody');if(b)requestAnimationFrame(()=>{b.scrollTop=mcSeriesScrollTop})}
};

function mcSeriesQuickPanel(html,title='Buscar datos y portada'){
  let p=document.getElementById('mcSeriesQuickPanel');
  if(!p){p=document.createElement('div');p.id='mcSeriesQuickPanel';p.className='ficha-search-box';const head=$('#modal .modalhead');head?.insertAdjacentElement('afterend',p)}
  p.innerHTML=`<div class="ficha-search-head"><b>${esc(title)}</b><button class="btn sm" onclick="mcCancelSeriesQuick()">Cerrar</button></div><div class="ficha-search-content">${html}</div>`;
  p.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function mcCancelSeriesQuick(){document.getElementById('mcSeriesQuickPanel')?.remove();mcSeriesQuickCandidates=[];mcSeriesQuickSelected=0;mcSeriesQuickId=''}
function mcSeriesQuickAdd(source,data){if(!data)return;const k=[source,data.externalId||'',data.isbn||'',data.issueNr||'',data.coverUrl||'',data.title||''].join('|');if(!mcSeriesQuickCandidates.some(c=>c._k===k))mcSeriesQuickCandidates.push({source,data,_k:k})}

async function mcQuickSearchSeriesIssue(id,encoded,ev){
  ev?.stopPropagation?.();mcRememberSeriesScroll();mcSeriesReturnEncoded=encoded;mcSeriesQuickId=id;mcSeriesQuickCandidates=[];mcSeriesQuickSelected=0;
  const x=await getStore('comics',id);if(!x)return toast('No se encontró la ficha');
  const series=x.catalogHeader||x.series,wanted=String(x.issueNr??x.issue??'').trim(),code=String(x.isbn||'').replace(/[^0-9A-Za-z]/g,'');
  mcSeriesQuickPanel(`<div class="muted">Buscando ${esc(series)}${wanted?' · nº '+esc(wanted):''}…</div>`);
  try{
    if(code){
      try{const key='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(key)+'&format=json&jscmd=data'),j=await r.json(),b=j[key];if(b)mcSeriesQuickAdd('Open Library · código',{title:b.title||'',pages:b.number_of_pages||'',publisher:b.publishers?.[0]?.name||'',publicationDate:mcNormalizeDate(b.publish_date),isbn:code,coverUrl:b.cover?.large||b.cover?.medium||'',writer:(b.authors||[]).map(a=>a.name).filter(Boolean).join(', '),series,issueNr:wanted,_exactCode:true})}catch{}
    }
    if(series&&wanted!==''){
      let u='https://www.comics.org/api/series/name/'+encodeURIComponent(series)+'/issue/'+encodeURIComponent(wanted)+'/';if(x.startYear)u+='year/'+encodeURIComponent(x.startYear)+'/';
      try{const r=await fetch(u,{headers:{Accept:'application/json'}});if(r.ok){const j=await r.json(),a=Array.isArray(j)?j:(j.results||[]);for(const it of a.slice(0,20)){const d=await mcFetchIssueDetail(it),actual=d.number??it.number??'';if(typeof mcIssueExact==='function'&&!mcIssueExact(wanted,actual))continue;const stories=d.story_set||[];mcSeriesQuickAdd('Grand Comics Database',{title:d.title||d.descriptor||'',publisher:typeof d.indicia_publisher==='string'?d.indicia_publisher:'',publicationDate:mcNormalizeDate(d.publication_date),pages:d.page_count||'',isbn:d.isbn||d.barcode||code||'',coverUrl:d.cover||'',volume:d.volume||'',series:d.series_name||series,issueNr:actual,startYear:x.startYear||mcYearFrom(d.publication_date),format:d.binding||'',writer:stories.map(s=>s.script).filter(Boolean).join(', '),artist:stories.map(s=>s.pencils).filter(Boolean).join(', '),inker:stories.map(s=>s.inks).filter(Boolean).join(', '),colorist:stories.map(s=>s.colors).filter(Boolean).join(', '),externalId:String(d.api_url||'')})}}}catch{}
    }
    if(wanted)mcSeriesQuickCandidates=mcSeriesQuickCandidates.filter(c=>c.data?._exactCode||(typeof mcIssueExact==='function'?mcIssueExact(wanted,c.data?.issueNr):String(c.data?.issueNr||'')===wanted));
    if(typeof mcCandidateScore==='function')mcSeriesQuickCandidates.sort((a,b)=>mcCandidateScore(b,x,code)-mcCandidateScore(a,x,code));
    mcRenderSeriesQuick(x);
  }catch(e){mcSeriesQuickPanel(`<div class="notice">No se pudo completar la búsqueda: ${esc(e.message||e)}</div><div class="result-actions" style="margin-top:12px"><button class="btn" onclick="mcCancelSeriesQuick()">Cancelar</button></div>`)}
}

function mcSelectSeriesQuick(i){mcSeriesQuickSelected=i;document.querySelectorAll('#mcSeriesQuickPanel .unified-result').forEach((el,n)=>el.classList.toggle('selected',n===i));document.querySelectorAll('#mcSeriesQuickPanel input[name="mcSeriesQuickPick"]').forEach((el,n)=>el.checked=n===i)}
function mcRenderSeriesQuick(x){
  if(!mcSeriesQuickCandidates.length)return mcSeriesQuickPanel(`<div class="notice">No se encontró una coincidencia fiable para <b>${esc(x.catalogHeader||x.series)} nº ${esc(x.issueNr||x.issue)}</b>.</div><div class="result-actions" style="margin-top:12px"><button class="btn" onclick="mcCancelSeriesQuick()">Cancelar</button></div>`,'Resultados');
  const cards=mcSeriesQuickCandidates.map((c,i)=>{const d=c.data||{};return `<article class="ficha-result unified-result ${i===mcSeriesQuickSelected?'selected':''}" onclick="mcSelectSeriesQuick(${i})" style="cursor:pointer"><div class="result-pick"><input type="radio" name="mcSeriesQuickPick" ${i===mcSeriesQuickSelected?'checked':''} onclick="event.stopPropagation();mcSelectSeriesQuick(${i})"></div>${d.coverUrl?`<img src="${esc(d.coverUrl)}" referrerpolicy="no-referrer" loading="lazy">`:'<div class="result-no-cover">Sin portada</div>'}<div><span class="source-pill">${esc(c.source)}</span><b>${esc(d.title||d.series||'Resultado')}</b><div class="small muted">${esc([d.publisher,d.series,d.issueNr!==''?('Nº '+d.issueNr):'',d.publicationDate,d.isbn&&('Código '+d.isbn)].filter(Boolean).join(' · '))}</div></div></article>`}).join('');
  mcSeriesQuickPanel(`<div class="ficha-result-grid unified-results">${cards}</div><div class="result-actions" style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px"><button class="btn" onclick="mcCancelSeriesQuick()">Cancelar</button><button class="btn primary" onclick="mcAcceptSeriesQuick()">Aceptar</button></div>`,'Resultados: datos y portada');
}

async function mcAcceptSeriesQuick(){
  const c=mcSeriesQuickCandidates[mcSeriesQuickSelected],id=mcSeriesQuickId;if(!c||!id)return toast('Selecciona un resultado');
  const x=await getStore('comics',id);if(!x)return toast('No se encontró la ficha');const d=c.data||{},a=x.authors||{};
  const y=cleanComic({...x,publisher:x.publisher||d.publisher,catalogHeader:x.catalogHeader||x.series||d.series,series:x.series||x.catalogHeader||d.series,volume:x.volume||d.volume,startYear:x.startYear||d.startYear,title:x.title||d.title,publicationDate:x.publicationDate||d.publicationDate,pages:x.pages||d.pages,isbn:x.isbn||d.isbn,format:x.format||d.format,authors:{...a,writer:a.writer||d.writer||'',artist:a.artist||d.artist||'',inker:a.inker||d.inker||'',colorist:a.colorist||d.colorist||''}});
  await putStore('comics',y);
  let coverSaved=false;
  if(!x.coverKey&&!x.coverUrl&&d.coverUrl&&CoverVault?.attach){try{await CoverVault.attach(y,d.coverUrl);coverSaved=true}catch(e){console.warn(e)}}
  const enc=mcSeriesReturnEncoded,scroll=mcSeriesScrollTop;mcCancelSeriesQuick();toast(coverSaved?'Datos y portada guardados':'Datos actualizados');await openSeries(enc);const b=$('#modal .modalbody');if(b)b.scrollTop=scroll;
}
