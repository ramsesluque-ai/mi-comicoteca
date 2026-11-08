'use strict';
(function(){
  function countBy(rows, fn){const m={};rows.forEach(x=>{const k=fn(x)||'Sin dato';m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  function barRows(items,kind){const mx=Math.max(1,...items.map(x=>x[1]));return items.map(([k,v])=>`<button class="pbi-bar-row" onclick="PbiDashboard.filter('${kind}','${encodeURIComponent(k)}')"><span class="pbi-label">${esc(k)}</span><span class="pbi-track"><i style="width:${Math.max(3,100*v/mx)}%"></i></span><b>${v.toLocaleString('es-ES')}</b></button>`).join('');}
  function yearBand(y){const n=parseInt(y,10);if(!Number.isFinite(n))return 'Sin año';const d=Math.floor(n/10)*10;return d+'–'+(d+9);}
  function monthKey(v){const s=String(v||'');return /^\d{4}-\d{2}/.test(s)?s.slice(0,7):'';}
  function collectionProgress(items){return items.slice(0,8).map(x=>{const pct=x.total?Math.round(100*x.have/x.total):0;const s=x.sample||{};return `<button class="pbi-progress-row" onclick="PbiDashboard.openCollection('${encodeURIComponent(x.key)}')"><span><b>${esc(s.catalogHeader||s.series||'Colección')}</b><small>${esc([s.publisher,s.volume,s.stage,s.startYear].filter(Boolean).join(' · '))}</small></span><span class="pbi-progress"><i style="width:${pct}%"></i></span><strong>${pct}%</strong></button>`}).join('');}
  async function view(){
    const rows=await allStore('comics'), purchases=await allStore('purchases');
    const inc=rows.filter(x=>x.status==='In Collection'), wish=rows.filter(x=>x.status==='On Wish List');
    const collections={}; rows.forEach(x=>{if(x.status!=='In Collection'&&x.status!=='On Wish List')return;const k=ckey(x);if(!collections[k])collections[k]={key:k,sample:x,have:0,total:0};collections[k].total++;if(x.status==='In Collection')collections[k].have++;});
    const cs=Object.values(collections), complete=cs.filter(x=>x.total&&x.have===x.total).length, pct=cs.length?Math.round(100*complete/cs.length):0;
    const estimated=inc.reduce((s,x)=>s+num(x.estimated),0), now=new Date(), mk=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
    const monthPurchases=purchases.filter(x=>monthKey(x.date)===mk), monthSpend=monthPurchases.reduce((s,x)=>s+num(x.price)+num(x.shipping),0);
    const pubs=countBy(inc,x=>x.publisher).slice(0,10), groups=countBy(inc,x=>x.group||'Sin grupo').slice(0,10), decades=countBy(inc,x=>yearBand(x.startYear)).slice(0,10);
    const recent=[...purchases].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,6);
    const progress=[...cs].filter(x=>x.total).sort((a,b)=>(b.total-b.have)-(a.total-a.have)||b.total-a.total);
    return head('Dashboard','Visión ejecutiva e interactiva de tu comicoteca.',`<button class="btn primary" onclick="editComic()">+ Añadir cómic</button>`)+`<div class="pbi-shell">
      <div class="pbi-kpis">
        <button onclick="PbiDashboard.goto('catalog','In Collection')"><span>En colección</span><b>${inc.length.toLocaleString('es-ES')}</b><small>Cómics registrados</small></button>
        <button onclick="PbiDashboard.goto('wishlist')"><span>Wishlist</span><b>${wish.length.toLocaleString('es-ES')}</b><small>Pendientes / deseados</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Colecciones</span><b>${cs.length.toLocaleString('es-ES')}</b><small>${complete.toLocaleString('es-ES')} completas</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Completitud</span><b>${pct}%</b><small>Series completas</small></button>
        <div><span>Valor estimado</span><b>${money(estimated)}</b><small>Valor registrado</small></div>
        <button onclick="PbiDashboard.goto('purchases')"><span>Compras del mes</span><b>${monthPurchases.length.toLocaleString('es-ES')}</b><small>${money(monthSpend)} este mes</small></button>
      </div>
      <div class="pbi-grid">
        <section class="pbi-panel"><div class="pbi-title"><b>Editoriales</b><span>Selecciona para filtrar catálogo</span></div>${barRows(pubs,'publisher')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Universos / grupos</b><span>Distribución de la colección</span></div>${barRows(groups,'group')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Décadas</b><span>Año de inicio de colección</span></div>${barRows(decades,'decade')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Últimas compras</b><span>${purchases.length.toLocaleString('es-ES')} registradas</span></div><div class="pbi-purchases">${recent.map(x=>`<div><span>${esc([x.publisher,x.series,x.issue&&('#'+x.issue)].filter(Boolean).join(' · ')||'Compra')}</span><b>${money(num(x.price)+num(x.shipping))}</b><small>${esc(x.date||'Sin fecha')}</small></div>`).join('')||'<div class="muted">Sin compras registradas</div>'}</div><button class="btn sm" onclick="PbiDashboard.goto('purchases')">Ver compras</button></section>
        <section class="pbi-panel pbi-wide"><div class="pbi-title"><b>Progreso de colecciones</b><span>Las que tienen más números pendientes</span></div><div class="pbi-progress-list">${collectionProgress(progress)||'<div class="muted">Sin colecciones</div>'}</div></section>
      </div>
    </div>`;
  }
  async function goto(v,status){await route(v);if(status&&v==='catalog'){filters.status=status;await render();}}
  async function filter(kind,value){const v=decodeURIComponent(value);if(kind==='publisher'){current='catalog';page=1;filters={publisher:v,status:'In Collection'};setNav('catalog');await render();return;}if(kind==='group'){current='catalog';page=1;filters={group:v,status:'In Collection'};setNav('catalog');await render();return;}if(kind==='decade'){current='catalog';page=1;filters={status:'In Collection',q:v.split('–')[0]};setNav('catalog');await render();}}
  async function openCollection(encoded){const key=decodeURIComponent(encoded);current='series';page=1;setNav('series');await render();if(typeof openSeries==='function')return openSeries(encodeURIComponent(key));if(typeof openCollection==='function')return openCollection(encodeURIComponent(key));}
  window.PbiDashboard={view,goto,filter,openCollection};
  window.dashboard=view;
})();