'use strict';
/* v14: acciones de enriquecimiento arriba, junto a la portada. */
let mcUnifiedCandidates=[];
const mcEditComicV13=editComic;
editComic=async function(id){
  await mcEditComicV13(id);
  const modal=$('#modal'),top=modal?.querySelector('.formgrid > .span4.toolbar'),foot=modal?.querySelector('.modalfoot');
  if(!top||!foot)return;
  foot.querySelectorAll('button').forEach(b=>{
    const t=(b.textContent||'').trim().toLowerCase(),oc=b.getAttribute('onclick')||'';
    if(t.includes('buscar datos')||t.includes('buscar portada')||t.includes('completar por isbn')||oc.includes('completeISBN'))b.remove();
  });
  const isbn=document.getElementById('m_isbn');
  if(isbn){const lab=isbn.closest('.field')?.querySelector('label');if(lab)lab.textContent='ISBN / EAN / UPC / código';}
  if(!top.querySelector('.ficha-top-actions')){
    const actions=document.createElement('div');
    actions.className='ficha-top-actions';
    actions.innerHTML=`<button class="btn primary" type="button" onclick="mcSearchFichaAll()">⌕ Buscar datos y portada</button><button class="btn" type="button" onclick="mcCompleteByCode()">▣ Completar por código</button><div class="small muted">Busca por ISBN/EAN/UPC cuando exista y también por Editorial + Serie/Cabecera + Nº + Año + Título.</div>`;
    const cover=top.firstElementChild;
    if(cover)cover.insertAdjacentElement('afterend',actions);else top.prepend(actions);
  }
  CoverVault?.hydrate?.();
};

function mcCandidateKey(d){return [d.source||'',d.externalId||'',d.isbn||'',d.title||'',d.publisher||'',d.coverUrl||''].join('|')}
function mcAddUnified(source,data){if(!data)return;const c={source,data};const k=mcCandidateKey({...data,source});if(!mcUnifiedCandidates.some(x=>mcCandidateKey({...x.data,source:x.source})===k))mcUnifiedCandidates.push(c)}
function mcNormalizeDate(v){v=String(v||'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const m=v.match(/(\d{4})/);return m?`${m[1]}-01-01`:''}
async function mcSearchFichaAll(){
  const x=mcFormComic(),series=x.catalogHeader||x.series,title=x.title||series,code=String(x.isbn||'').replace(/[^0-9A-Za-z]/g,'');
  if(!code&&!series&&!title)return toast('Informa un código, cabecera/serie o título para buscar');
  mcUnifiedCandidates=[];mcShowSearch('Buscar datos y portada','<div class="muted">Consultando fuentes por código y por datos de la ficha…</div>');
  try{
    if(code){
      try{
        const k='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(k)+'&format=json&jscmd=data'),j=await r.json(),b=j[k];
        if(b)mcAddUnified('Open Library · código',{title:b.title||'',pages:b.number_of_pages||'',publisher:b.publishers?.[0]?.name||'',publicationDate:mcNormalizeDate(b.publish_date),isbn:code,coverUrl:b.cover?.large||b.cover?.medium||'',writer:(b.authors||[]).map(a=>a.name).filter(Boolean).join(', ')});
      }catch{}
    }
    if(series&&x.issueNr!==''){
      let u='https://www.comics.org/api/series/name/'+encodeURIComponent(series)+'/issue/'+encodeURIComponent(x.issueNr)+'/';if(x.startYear)u+='year/'+encodeURIComponent(x.startYear)+'/';
      try{
        const r=await fetch(u,{headers:{Accept:'application/json'}});if(r.ok){const j=await r.json(),a=Array.isArray(j)?j:(j.results||[]);for(const it of a.slice(0,10)){const d=await mcFetchIssueDetail(it),stories=d.story_set||[];mcAddUnified('Grand Comics Database',{title:d.title||d.descriptor||'',publisher:typeof d.indicia_publisher==='string'?d.indicia_publisher:'',publicationDate:mcNormalizeDate(d.publication_date),pages:d.page_count||'',isbn:d.isbn||d.barcode||code||'',coverUrl:d.cover||'',volume:d.volume||'',series:d.series_name||series,format:d.binding||'',writer:stories.map(s=>s.script).filter(Boolean).join(', '),artist:stories.map(s=>s.pencils).filter(Boolean).join(', '),inker:stories.map(s=>s.inks).filter(Boolean).join(', '),colorist:stories.map(s=>s.colors).filter(Boolean).join(', '),externalId:String(d.api_url||'')});}}
      }catch{}
    }
    if(title){
      try{
        const u='https://openlibrary.org/search.json?title='+encodeURIComponent(title)+(x.publisher?'&publisher='+encodeURIComponent(x.publisher):'')+'&limit=8',r=await fetch(u),j=await r.json();
        for(const d of (j.docs||[]).slice(0,8))mcAddUnified('Open Library · datos',{title:d.title||'',publisher:(d.publisher||[])[0]||'',publicationDate:d.first_publish_year?`${d.first_publish_year}-01-01`:'',isbn:(d.isbn||[])[0]||'',coverUrl:d.cover_i?'https://covers.openlibrary.org/b/id/'+d.cover_i+'-L.jpg':'',writer:(d.author_name||[]).join(', ')});
      }catch{}
    }
    mcRenderUnifiedResults();
  }catch(e){mcShowSearch('Buscar datos y portada',`<div class="notice">No se pudo completar la búsqueda: ${esc(e.message||e)}</div>`)}
}
function mcRenderUnifiedResults(){
  const html=mcUnifiedCandidates.length?`<div class="ficha-result-grid unified-results">${mcUnifiedCandidates.map((c,i)=>{const d=c.data;return `<article class="ficha-result unified-result">${d.coverUrl?`<img src="${esc(d.coverUrl)}" referrerpolicy="no-referrer" loading="lazy">`:'<div class="result-no-cover">Sin portada</div>'}<div><span class="source-pill">${esc(c.source)}</span><b>${esc(d.title||d.series||'Resultado')}</b><div class="small muted">${esc([d.publisher,d.series,d.publicationDate,d.isbn&&('Código '+d.isbn)].filter(Boolean).join(' · '))}</div><div class="result-actions"><button class="btn sm" onclick="mcApplyUnified(${i},false)">Completar datos</button>${d.coverUrl?`<button class="btn sm primary" onclick="mcApplyUnified(${i},true)">Completar + guardar portada</button>`:''}</div></div></article>`}).join('')}</div>`:'<div class="notice">No se encontraron candidatos automáticos con la información actual.</div>';
  mcShowSearch('Resultados: datos y portada',html);
}
async function mcApplyUnified(i,saveCover){
  const d=mcUnifiedCandidates[i]?.data;if(!d)return;
  mcSetBlank('publisher',d.publisher);mcSetBlank('catalogHeader',d.series);mcSetBlank('series',d.series);mcSetBlank('volume',d.volume);mcSetBlank('title',d.title);mcSetBlank('publicationDate',d.publicationDate);mcSetBlank('pages',d.pages);mcSetBlank('isbn',d.isbn);mcSetBlank('format',d.format);mcSetBlank('writer',d.writer);mcSetBlank('artist',d.artist);mcSetBlank('inker',d.inker);mcSetBlank('colorist',d.colorist);
  if(saveCover&&d.coverUrl){
    busy(true,'Completando ficha y guardando portada…');
    try{const r=await mcPersistFormForCover();await CoverVault.attach(r,d.coverUrl);toast('Datos completados y portada guardada en MI COMICOTECA');await editComic(r.id)}catch(e){toast('Datos completados; no se pudo guardar la portada: '+(e.message||e))}finally{busy(false)}
  }else{toast('Datos completados sin sobrescribir campos informados')}
}
async function mcCompleteByCode(){
  const code=String(val('isbn')||'').replace(/[^0-9A-Za-z]/g,'');
  if(!code)return toast('Indica primero un ISBN, EAN, UPC u otro código');
  await mcSearchFichaAll();
  if(mcUnifiedCandidates.length===1){const d=mcUnifiedCandidates[0]?.data||{};mcApplyUnified(0,!!d.coverUrl)}
}
