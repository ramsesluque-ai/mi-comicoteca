'use strict';
/* v21: filtros completos en Colecciones + búsqueda GCD robusta por Serie/Nº, validando editorial/país/año de serie. */

function mcSeriesFilterRows(rows, upto='all'){
  const order=['publisher','catalogHeader','volume','stage','startYear'];
  let a=rows.slice();
  for(const k of order){
    if(filters[k])a=a.filter(x=>String(x[k]??'')===String(filters[k]));
    if(k===upto)break;
  }
  if(filters.status)a=a.filter(x=>x.status===filters.status);
  return a;
}
function mcSeriesSelect(field,label,rows){return filtOpts(rows,field,label,filters[field]||'')}
function mcSeriesFilterChange(field,value){
  filters[field]=value;
  const order=['publisher','catalogHeader','volume','stage','startYear'];
  const i=order.indexOf(field);
  if(i>=0)order.slice(i+1).forEach(k=>delete filters[k]);
  page=1;render();
}
function mcSeriesStatusChange(value){filters.status=value;page=1;renderSeries()}

seriesView=async function(){
  const r=await allStore('comics');
  const byPub=mcSeriesFilterRows(r,'publisher');
  const byHeader=mcSeriesFilterRows(r,'catalogHeader');
  const byVolume=mcSeriesFilterRows(r,'volume');
  const byStage=mcSeriesFilterRows(r,'stage');
  return head('Colecciones','Tus series agrupadas por Editorial + Cabecera + Volumen/Etapa + Año. Los filtros funcionan igual que en Catálogo.')+
  `<div class="panel"><div class="filters series-filters">
    <input id="sq" value="${esc(filters.q||'')}" placeholder="Buscar…">
    ${mcSeriesSelect('publisher','Todas las editoriales',r).replace('data-f="publisher"','onchange="mcSeriesFilterChange(\'publisher\',this.value)"')}
    ${mcSeriesSelect('catalogHeader','Todas las cabeceras',byPub).replace('data-f="catalogHeader"','onchange="mcSeriesFilterChange(\'catalogHeader\',this.value)"')}
    ${mcSeriesSelect('volume','Todos los volúmenes',byHeader).replace('data-f="volume"','onchange="mcSeriesFilterChange(\'volume\',this.value)"')}
    ${mcSeriesSelect('stage','Todas las etapas',byVolume).replace('data-f="stage"','onchange="mcSeriesFilterChange(\'stage\',this.value)"')}
    ${mcSeriesSelect('startYear','Todos los años',byStage).replace('data-f="startYear"','onchange="mcSeriesFilterChange(\'startYear\',this.value)"')}
    <select onchange="mcSeriesStatusChange(this.value)">
      <option value="">Todos los estados</option>
      <option value="In Collection" ${filters.status==='In Collection'?'selected':''}>En colección</option>
      <option value="On Wish List" ${filters.status==='On Wish List'?'selected':''}>Wishlist</option>
      <option value="__blank__" ${filters.status==='__blank__'?'selected':''}>Sin estado</option>
    </select>
  </div><div id="seriesbody"></div></div>`;
};

renderSeries=async function(){
  let r=(await allStore('comics')).slice().sort(mcSortRecord);
  if(filters.publisher)r=r.filter(x=>x.publisher===filters.publisher);
  if(filters.catalogHeader)r=r.filter(x=>x.catalogHeader===filters.catalogHeader);
  if(filters.volume)r=r.filter(x=>String(x.volume??'')===String(filters.volume));
  if(filters.stage)r=r.filter(x=>String(x.stage??'')===String(filters.stage));
  if(filters.startYear)r=r.filter(x=>String(x.startYear??'')===String(filters.startYear));
  if(filters.status==='__blank__')r=r.filter(x=>!x.status); else if(filters.status)r=r.filter(x=>x.status===filters.status);
  const master=await allStore('master'),mt={};master.forEach(x=>mt[ckey(x)]=(mt[ckey(x)]||0)+1);
  const q=norm(filters.q||$('#sq')?.value||''),m={};
  r.forEach(x=>{const k=ckey(x);m[k]??={sample:x,have:0,wish:0,total:0,cover:''};m[k].total++;if(x.status==='In Collection')m[k].have++;if(x.status==='On Wish List')m[k].wish++;if(!m[k].cover&&(x.coverKey||x.coverUrl))m[k].cover=x.coverKey?'key:'+x.coverKey:x.coverUrl});
  let a=Object.entries(m).filter(([,x])=>!q||norm(clabel(x.sample)).includes(q)).sort((a,b)=>mcSortRecord(a[1].sample,b[1].sample));
  const per=60,pages=Math.max(1,Math.ceil(a.length/per));page=Math.min(page,pages);const slice=a.slice((page-1)*per,page*per);
  $('#seriesbody').innerHTML=`<div class="series-grid visual">${slice.map(([k,x])=>{const total=mt[k]||x.total,pct=total?Math.round(x.have*100/total):0,s={...x.sample};if(x.cover?.startsWith('key:'))s.coverKey=x.cover.slice(4);else if(x.cover)s.coverUrl=x.cover;return `<article class="series-card visual" onclick="openSeries('${encodeURIComponent(k)}')"><div class="series-cover">${img(s,'cover seriescover')}</div><div class="series-content"><div class="comic-kicker">${esc(x.sample.publisher||'Sin editorial')}</div><div class="series-title">${esc(x.sample.catalogHeader||x.sample.series)}</div><div class="master-meta">${esc([x.sample.volume&&('Vol. '+x.sample.volume),x.sample.stage,x.sample.startYear].filter(Boolean).join(' · ')||'Edición sin identificar')}</div><div class="progress"><span style="width:${Math.min(100,pct)}%;background:${typeof mcPctColor==='function'?mcPctColor(pct):''}"></span></div><div class="series-stats"><b>${x.have}</b> en colección · <b>${x.wish}</b> wishlist · <b>${total}</b> total</div><div class="series-percent">${pct}%</div></div></article>`}).join('')||'<div class="empty">Sin resultados.</div>'}</div><div class="pager"><span>${a.length.toLocaleString('es-ES')} colecciones · Página ${page}/${pages}</span><span><button class="btn sm" ${page<=1?'disabled':''} onclick="page--;renderSeries()">Anterior</button> <button class="btn sm" ${page>=pages?'disabled':''} onclick="page++;renderSeries()">Siguiente</button></span></div>`;
  const sq=$('#sq');if(sq)sq.oninput=()=>{filters.q=sq.value;page=1;renderSeries()};
  CoverVault?.hydrate?.();
};

function mcSearchNameVariants(x){
  const vals=[x.catalogHeader,x.series,x.title].filter(Boolean),pub=norm(x.publisher),out=[];
  const add=v=>{v=String(v||'').replace(/\s+/g,' ').trim();if(v&&!out.some(z=>norm(z)===norm(v)))out.push(v)};
  for(const raw of vals){
    add(raw);
    const parts=String(raw).split(/\s+-\s+/).map(s=>s.trim()).filter(Boolean);
    if(parts.length>1){add(parts[0]);const withoutPub=parts.filter(p=>norm(p)!==pub).join(' - ');add(withoutPub)}
    if(x.publisher){const rx=new RegExp('\\s*[-–—:]?\\s*'+String(x.publisher).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$','i');add(String(raw).replace(rx,''))}
    add(String(raw).replace(/\s*\((?:vol\.?|volumen|serie|etapa)[^)]*\)\s*$/i,''));
  }
  return out.slice(0,5);
}
async function mcFetchJsonUrl(url){if(!url)return null;try{const r=await fetch(url,{headers:{Accept:'application/json'},cache:'force-cache'});if(r.ok)return await r.json()}catch{}return null}
async function mcSeriesMetaFromIssue(d,it){
  const u=d?.series||it?.series;let s=await mcFetchJsonUrl(u);
  if(!s&&typeof u==='number')s=await mcFetchJsonUrl('https://www.comics.org/api/series/'+u+'/');
  let p=null,pname='';
  if(s?.publisher){p=await mcFetchJsonUrl(s.publisher);pname=p?.name||''}
  return {series:s,publisher:p,publisherName:pname,country:s?.country||p?.country||'',year:s?.year_began||''};
}
async function mcGcdCandidatesForComic(x){
  const wanted=String(x.issueNr??x.issue??'').trim();if(!wanted)return[];
  const names=mcSearchNameVariants(x),seen=new Set(),out=[];
  for(const name of names){
    let j=null;
    try{const r=await fetch('https://www.comics.org/api/series/name/'+encodeURIComponent(name)+'/issue/'+encodeURIComponent(wanted)+'/',{headers:{Accept:'application/json'}});if(!r.ok)continue;j=await r.json()}catch{continue}
    const arr=Array.isArray(j)?j:(j.results||[]);
    for(const it of arr.slice(0,30)){
      const d=await mcFetchIssueDetail(it),actual=d.number??'';
      if(!mcIssueExact(wanted,actual))continue;
      const key=d.api_url||it.api_url||`${d.series_name}|${actual}|${d.publication_date}`;if(seen.has(key))continue;seen.add(key);
      const meta=await mcSeriesMetaFromIssue(d,it),s=meta.series||{},pname=meta.publisherName||d.indicia_publisher||'',country=String(meta.country||'').toLowerCase();
      const stories=d.story_set||[];
      const data={title:d.title||d.descriptor||'',publisher:pname,publicationDate:mcNormalizeDate(d.publication_date),pages:d.page_count||'',isbn:d.isbn||d.barcode||'',coverUrl:d.cover||'',volume:d.volume||'',series:s.name||d.series_name||name,issueNr:actual,startYear:meta.year||'',format:s.binding||d.binding||'',writer:stories.map(z=>z.script).filter(Boolean).join(', '),artist:stories.map(z=>z.pencils).filter(Boolean).join(', '),inker:stories.map(z=>z.inks).filter(Boolean).join(', '),colorist:stories.map(z=>z.colors).filter(Boolean).join(', '),externalId:String(d.api_url||''),_country:country,_query:name};
      let score=500;
      if(country==='es')score+=350;else if(country)score-=150;
      const qs=norm(x.catalogHeader||x.series),ds=norm(data.series);if(qs&&ds){if(qs===ds)score+=220;else if(qs.includes(ds)||ds.includes(qs))score+=120}
      const qp=norm(x.publisher),dp=norm(data.publisher);if(qp&&dp){if(qp===dp)score+=220;else if(qp.includes(dp)||dp.includes(qp))score+=90;else score-=80}
      if(x.startYear&&data.startYear){if(String(x.startYear)===String(data.startYear))score+=180;else score-=35}
      out.push({source:'Grand Comics Database',data,_score:score});
    }
    if(out.some(c=>c._score>=1000))break;
  }
  return out.sort((a,b)=>b._score-a._score).slice(0,12);
}

mcSearchFichaAll=async function(){
  const x=mcFormComic(),series=x.catalogHeader||x.series,title=x.title||'',wanted=String(x.issueNr??'').trim(),code=String(x.isbn||'').replace(/[^0-9A-Za-z]/g,'');
  if(!code&&!series&&!title)return toast('Informa un código, cabecera/serie o título para buscar');
  mcUnifiedCandidates=[];mcUnifiedSelected=0;mcShowSearch('Buscar datos y portada',`<div class="muted">Buscando ${wanted?`${esc(series)} · nº ${esc(wanted)}`:'por los datos de la ficha'}…</div>`);
  try{
    if(code){try{const k='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(k)+'&format=json&jscmd=data'),j=await r.json(),b=j[k];if(b)mcAddUnified('Open Library · código',{title:b.title||'',pages:b.number_of_pages||'',publisher:b.publishers?.[0]?.name||'',publicationDate:mcNormalizeDate(b.publish_date),isbn:code,coverUrl:b.cover?.large||b.cover?.medium||'',writer:(b.authors||[]).map(a=>a.name).filter(Boolean).join(', '),series:series||'',issueNr:wanted||'',_exactCode:true})}catch{}}
    if(wanted){for(const c of await mcGcdCandidatesForComic(x))mcAddUnified(c.source,c.data)}
    else if(title||series){try{const q=title||series,u='https://openlibrary.org/search.json?title='+encodeURIComponent(q)+(x.publisher?'&publisher='+encodeURIComponent(x.publisher):'')+'&limit=8',r=await fetch(u),j=await r.json();for(const d of (j.docs||[]).slice(0,8))mcAddUnified('Open Library · datos',{title:d.title||'',publisher:(d.publisher||[])[0]||'',publicationDate:d.first_publish_year?`${d.first_publish_year}-01-01`:'',isbn:(d.isbn||[])[0]||'',coverUrl:d.cover_i?'https://covers.openlibrary.org/b/id/'+d.cover_i+'-L.jpg':'',writer:(d.author_name||[]).join(', '),series:series||'',issueNr:''})}catch{}}
    if(wanted)mcUnifiedCandidates=mcUnifiedCandidates.filter(c=>c.data?._exactCode||mcIssueExact(wanted,c.data?.issueNr));
    mcUnifiedCandidates.sort((a,b)=>{const aa=a.data?._country==='es'?1000:0,bb=b.data?._country==='es'?1000:0;return bb-aa+mcCandidateScore(b,x,code)-mcCandidateScore(a,x,code)});
    mcRenderUnifiedResults();
  }catch(e){mcShowSearch('Buscar datos y portada',`<div class="notice">No se pudo completar la búsqueda: ${esc(e.message||e)}</div>`)}
};

mcQuickSearchSeriesIssue=async function(id,encoded,ev){
  ev?.stopPropagation?.();mcRememberSeriesScroll();mcSeriesReturnEncoded=encoded;mcSeriesQuickId=id;mcSeriesQuickCandidates=[];mcSeriesQuickSelected=0;
  const x=await getStore('comics',id);if(!x)return toast('No se encontró la ficha');
  const wanted=String(x.issueNr??x.issue??'').trim(),code=String(x.isbn||'').replace(/[^0-9A-Za-z]/g,'');
  mcSeriesQuickPanel(`<div class="muted">Buscando ${esc(x.catalogHeader||x.series)}${wanted?' · nº '+esc(wanted):''}…</div>`);
  try{
    if(code){try{const key='ISBN:'+code,r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(key)+'&format=json&jscmd=data'),j=await r.json(),b=j[key];if(b)mcSeriesQuickAdd('Open Library · código',{title:b.title||'',pages:b.number_of_pages||'',publisher:b.publishers?.[0]?.name||'',publicationDate:mcNormalizeDate(b.publish_date),isbn:code,coverUrl:b.cover?.large||b.cover?.medium||'',writer:(b.authors||[]).map(a=>a.name).filter(Boolean).join(', '),series:x.catalogHeader||x.series,issueNr:wanted,_exactCode:true})}catch{}}
    if(wanted){for(const c of await mcGcdCandidatesForComic(x))mcSeriesQuickAdd(c.source,c.data)}
    if(wanted)mcSeriesQuickCandidates=mcSeriesQuickCandidates.filter(c=>c.data?._exactCode||mcIssueExact(wanted,c.data?.issueNr));
    mcSeriesQuickCandidates.sort((a,b)=>{const aa=a.data?._country==='es'?1000:0,bb=b.data?._country==='es'?1000:0;return bb-aa+mcCandidateScore(b,x,code)-mcCandidateScore(a,x,code)});
    mcRenderSeriesQuick(x);
  }catch(e){mcSeriesQuickPanel(`<div class="notice">No se pudo completar la búsqueda: ${esc(e.message||e)}</div><div class="result-actions" style="margin-top:12px"><button class="btn" onclick="mcCancelSeriesQuick()">Cancelar</button></div>`)}
};
