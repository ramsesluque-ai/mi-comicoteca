'use strict';
(function(){
  const fmt=n=>(Number(n)||0).toLocaleString('es-ES');
  function countBy(rows,fn){const m={};rows.forEach(x=>{const k=String(fn(x)||'Sin dato').trim()||'Sin dato';m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  function splitPeople(v){return String(v||'').split(/[,;|\/]+/).map(x=>x.trim()).filter(Boolean);}
  function countMulti(rows,fields){const m={};rows.forEach(x=>fields.forEach(f=>splitPeople(x[f]).forEach(k=>m[k]=(m[k]||0)+1)));return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  function yearBand(y){const n=parseInt(y,10);if(!Number.isFinite(n))return 'Sin año';const d=Math.floor(n/10)*10;return d+'–'+(d+9);}
  function monthKey(v){const s=String(v||'');return /^\d{4}-\d{2}/.test(s)?s.slice(0,7):'';}
  function bars(items,kind,limit=9){const a=items.slice(0,limit),mx=Math.max(1,...a.map(x=>x[1]));return a.map(([k,v])=>`<button class="pbi-bar-row" onclick="PbiDashboard.filter('${kind}','${encodeURIComponent(k)}')"><span class="pbi-label" title="${esc(k)}">${esc(k)}</span><span class="pbi-track"><i style="width:${Math.max(4,100*v/mx)}%"></i></span><b>${fmt(v)}</b></button>`).join('');}
  function collectionProgress(items){return items.slice(0,10).map(x=>{const pct=x.total?Math.round(100*x.have/x.total):0,s=x.sample||{};return `<button class="pbi-progress-row" onclick="PbiDashboard.openCollection('${encodeURIComponent(x.key)}')"><span><b>${esc(s.catalogHeader||s.series||'Colección')}</b><small>${esc([s.publisher,s.volume,s.stage,s.startYear].filter(Boolean).join(' · '))}</small></span><span class="pbi-progress"><i style="width:${pct}%"></i></span><strong>${pct}%</strong></button>`}).join('');}
  function qualityCard(label,value,total,action){const pct=total?Math.round(value*100/total):0;return `<button class="pbi-quality" onclick="${action}"><span>${label}</span><b>${fmt(value)}</b><small>${pct}% del catálogo</small><i><em style="width:${pct}%"></em></i></button>`;}
  function monthBars(purchases){const m={};purchases.forEach(x=>{const k=monthKey(x.date);if(k)m[k]=(m[k]||0)+num(x.price)+num(x.shipping)});const a=Object.entries(m).sort((a,b)=>a[0].localeCompare(b[0])).slice(-12),mx=Math.max(1,...a.map(x=>x[1]));return `<div class="pbi-months">${a.map(([k,v])=>`<div title="${k}: ${money(v)}"><i style="height:${Math.max(5,100*v/mx)}%"></i><small>${k.slice(5)}</small></div>`).join('')||'<span class="muted">Sin compras fechadas</span>'}</div>`;}
  async function view(){
    const rows=await allStore('comics'),purchases=await allStore('purchases');
    const inc=rows.filter(x=>x.status==='In Collection'),wish=rows.filter(x=>x.status==='On Wish List');
    const collections={};rows.forEach(x=>{if(!['In Collection','On Wish List'].includes(x.status))return;const k=ckey(x);if(!collections[k])collections[k]={key:k,sample:x,have:0,total:0};collections[k].total++;if(x.status==='In Collection')collections[k].have++;});
    const cs=Object.values(collections),complete=cs.filter(x=>x.total&&x.have===x.total).length,incomplete=cs.length-complete,pct=cs.length?Math.round(100*complete/cs.length):0;
    const estimated=inc.reduce((s,x)=>s+num(x.estimated),0),now=new Date(),mk=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0'),monthPurchases=purchases.filter(x=>monthKey(x.date)===mk),monthSpend=monthPurchases.reduce((s,x)=>s+num(x.price)+num(x.shipping),0);
    const pubs=countBy(inc,x=>x.publisher),groups=countBy(inc,x=>x.group||x.universe||x.character||'Sin grupo'),authors=countMulti(inc,['writer','writers','script','author','authors','artist','artists','penciller']),decades=countBy(inc,x=>yearBand(x.startYear||x.year));
    const recent=[...purchases].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,6),progress=[...cs].filter(x=>x.total).sort((a,b)=>(b.total-b.have)-(a.total-a.have)||b.total-a.total);
    const noCover=inc.filter(x=>!(x.cover||x.coverUrl||x.image||x.imageUrl)).length,noIsbn=inc.filter(x=>!(x.isbn||x.ISBN)).length,lowQuality=inc.filter(x=>String(x.quality||'').toLowerCase().includes('baj')||String(x.condition||'').toLowerCase().includes('poor')).length;
    return head('Dashboard','Centro de control interactivo de tu comicoteca.',`<button class="btn primary" onclick="editComic()">+ Añadir cómic</button>`)+`<div class="pbi-shell">
      <div class="pbi-kpis">
        <button onclick="PbiDashboard.goto('catalog','In Collection')"><span>En colección</span><b>${fmt(inc.length)}</b><small>Cómics registrados</small></button>
        <button onclick="PbiDashboard.goto('wishlist')"><span>Wishlist</span><b>${fmt(wish.length)}</b><small>Pendientes / deseados</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Colecciones</span><b>${fmt(cs.length)}</b><small>${fmt(complete)} completas · ${fmt(incomplete)} incompletas</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Completitud</span><b>${pct}%</b><small>Series completas</small></button>
        <div><span>Valor estimado</span><b>${money(estimated)}</b><small>Valor registrado</small></div>
        <button onclick="PbiDashboard.goto('purchases')"><span>Compras del mes</span><b>${fmt(monthPurchases.length)}</b><small>${money(monthSpend)} este mes</small></button>
      </div>
      <div class="pbi-grid pbi-grid-3">
        <section class="pbi-panel"><div class="pbi-title"><b>Editoriales</b><span>Clic para filtrar</span></div>${bars(pubs,'publisher')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Personajes / universos</b><span>Distribución</span></div>${bars(groups,'group')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Autores</b><span>Guionistas y artistas</span></div>${bars(authors,'author')||'<div class="muted">Sin datos de autores</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Décadas</b><span>Año de inicio</span></div>${bars(decades,'decade')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Evolución de compras</b><span>Gasto · últimos 12 meses</span></div>${monthBars(purchases)}<button class="btn sm" onclick="PbiDashboard.goto('purchases')">Abrir compras</button></section>
        <section class="pbi-panel"><div class="pbi-title"><b>Calidad del catálogo</b><span>Pendientes de completar</span></div><div class="pbi-quality-grid">${qualityCard('Sin portada',noCover,inc.length,"PbiDashboard.goto('covers')")}${qualityCard('Sin ISBN',noIsbn,inc.length,"PbiDashboard.goto('quality')")}${qualityCard('Calidad baja',lowQuality,inc.length,"PbiDashboard.goto('quality')")}</div></section>
        <section class="pbi-panel pbi-wide"><div class="pbi-title"><b>Progreso de colecciones</b><span>Series con más números pendientes</span></div><div class="pbi-progress-list">${collectionProgress(progress)||'<div class="muted">Sin colecciones</div>'}</div></section>
        <section class="pbi-panel"><div class="pbi-title"><b>Últimas compras</b><span>${fmt(purchases.length)} registradas</span></div><div class="pbi-purchases">${recent.map(x=>`<div><span>${esc([x.publisher,x.series,x.issue&&('#'+x.issue)].filter(Boolean).join(' · ')||'Compra')}</span><b>${money(num(x.price)+num(x.shipping))}</b><small>${esc(x.date||'Sin fecha')}</small></div>`).join('')||'<div class="muted">Sin compras registradas</div>'}</div></section>
      </div>
    </div>`;
  }
  async function goto(v,status){await route(v);if(status&&v==='catalog'){filters.status=status;await render();}}
  async function filter(kind,value){const v=decodeURIComponent(value);current='catalog';page=1;filters={status:'In Collection'};if(kind==='publisher')filters.publisher=v;else if(kind==='group')filters.group=v;else if(kind==='author')filters.q=v;else if(kind==='decade')filters.q=v.split('–')[0];setNav('catalog');await render();}
  async function openCollection(encoded){const key=decodeURIComponent(encoded);current='series';page=1;setNav('series');await render();if(typeof openSeries==='function')return openSeries(encodeURIComponent(key));if(typeof openCollection==='function')return openCollection(encodeURIComponent(key));}
  window.PbiDashboard={view,goto,filter,openCollection};window.dashboard=view;
})();