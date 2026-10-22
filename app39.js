'use strict';
/* v52: filtros de Colecciones + progreso calculado siempre contra el total real del Maestro. */
(function(){
  if(!window.mcCollectionIdentityV50||typeof allStore!=='function')return;
  const api=window.mcCollectionIdentityV50;
  const n=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const canonHeader=v=>typeof window.mcCanonicalSeriesHeader==='function'?window.mcCanonicalSeriesHeader(v):n(v);
  const canonPub=v=>typeof mcSECanonPub==='function'?n(mcSECanonPub(v)):n(v);
  const same=(a,b)=>n(a)===n(b);

  function applyFilters(rows,f=filters||{}){
    let r=rows.slice();
    if(f.publisher)r=r.filter(x=>canonPub(x.publisher)===canonPub(f.publisher));
    if(f.catalogHeader)r=r.filter(x=>canonHeader(x.catalogHeader||x.series)===canonHeader(f.catalogHeader));
    if(f.volume)r=r.filter(x=>same(x.volume,f.volume));
    if(f.stage)r=r.filter(x=>same(x.stage,f.stage));
    if(f.startYear)r=r.filter(x=>String(x.startYear??'').trim()===String(f.startYear).trim());
    if(f.status==='__blank__')r=r.filter(x=>!x.status);
    else if(f.status)r=r.filter(x=>x.status===f.status);
    const q=n(f.q||document.querySelector('#sq')?.value||'');
    if(q)r=r.filter(x=>n([x.publisher,x.catalogHeader,x.series,x.volume,x.stage,x.startYear,x.title,x.issueNr,x.isbn].join(' ')).includes(q));
    return r;
  }

  async function renderSeriesV52(){
    const all=await allStore('comics');
    /* IMPORTANTE: el Maestro se carga con TODO el catálogo local para obtener el total real
       de cada colección. Los filtros solo deciden qué colecciones se muestran. */
    const st=await api.currentStatic(all);
    const filtered=applyFilters(all);
    const m={};
    for(const x of filtered){
      const k=api.resolvedKey(x,st);
      if(!m[k])m[k]={sample:x,cover:null,haveSet:new Set(),wishSet:new Set(),personalSet:new Set(),inRecords:0,wishRecords:0};
      const g=m[k],ik=api.issueKey(x);g.personalSet.add(ik);
      if(x.status==='In Collection'){g.haveSet.add(ik);g.inRecords++}
      if(x.status==='On Wish List'){g.wishSet.add(ik);g.wishRecords++}
      if(!g.cover&&(x.coverUrl||x.coverKey||x.coverSourceUrl))g.cover=x;
    }
    let a=Object.entries(m).map(([k,x])=>{
      const me=st.full.get(k);if(me)x.sample=me.sample;
      x.have=x.haveSet.size;x.wish=x.wishSet.size;x.personalTotal=x.personalSet.size;
      x.total=me?.total||x.personalTotal;x.duplicates=Math.max(0,x.inRecords-x.have)+Math.max(0,x.wishRecords-x.wish);
      return[k,x];
    }).sort((a,b)=>clabel(a[1].sample).localeCompare(clabel(b[1].sample),'es',{numeric:true}));
    const per=60,pages=Math.max(1,Math.ceil(a.length/per));page=Math.max(1,Math.min(page,pages));const slice=a.slice((page-1)*per,page*per),body=document.querySelector('#seriesbody');if(!body)return;
    body.innerHTML=`<div class="series-grid visual">${slice.map(([k,x])=>{const pct=x.total?Math.round(100*Math.min(x.have,x.total)/x.total):0,s=x.cover||x.sample,dup=x.duplicates?`<div class="muted small">${x.duplicates} registro${x.duplicates===1?'':'s'} duplicado${x.duplicates===1?'':'s'} detectado${x.duplicates===1?'':'s'}</div>`:'';return `<article class="series-card visual" onclick="openSeries('${encodeURIComponent(k)}')"><div class="series-cover">${img(s,'cover seriescover')}</div><div class="series-content"><div class="comic-kicker">${esc(x.sample.publisher||'Sin editorial')}</div><div class="series-title">${esc(x.sample.catalogHeader||x.sample.series)}</div><div class="master-meta">${esc([x.sample.volume&&('Vol. '+x.sample.volume),x.sample.stage,x.sample.startYear].filter(Boolean).join(' · ')||'Edición sin identificar')}</div><div class="progress"><span style="width:${Math.min(100,pct)}%"></span></div><div class="series-stats"><b>${x.have}</b> en colección · <b>${x.wish}</b> wishlist · <b>${x.total}</b> total</div><div class="series-percent">${pct}%</div>${dup}</div></article>`}).join('')||'<div class="empty">Sin resultados con estos filtros.</div>'}</div><div class="pager"><span>${a.length.toLocaleString('es-ES')} colecciones · Página ${page}/${pages}</span><span><button class="btn sm" ${page<=1?'disabled':''} onclick="page--;renderSeries()">Anterior</button> <button class="btn sm" ${page>=pages?'disabled':''} onclick="page++;renderSeries()">Siguiente</button></span></div>`;
    const sq=document.querySelector('#sq');if(sq)sq.oninput=()=>{filters.q=sq.value;page=1;renderSeries()};
    if(typeof mcVFPaint==='function')mcVFPaint();
    try{CoverVault?.hydrate?.()}catch{}
  }

  renderSeries=renderSeriesV52;window.renderSeries=renderSeriesV52;
  window.mcSeriesFilterV51=applyFilters;
  window.mcSeriesProgressV52=true;
})();