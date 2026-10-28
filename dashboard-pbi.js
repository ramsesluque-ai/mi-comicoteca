'use strict';
(function(){
  function countBy(rows, fn){const m={};rows.forEach(x=>{const k=fn(x)||'Sin dato';m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  function barRows(items,kind){const mx=Math.max(1,...items.map(x=>x[1]));return items.map(([k,v])=>`<button class="pbi-bar-row" onclick="PbiDashboard.filter('${kind}','${encodeURIComponent(k)}')"><span class="pbi-label">${esc(k)}</span><span class="pbi-track"><i style="width:${Math.max(3,100*v/mx)}%"></i></span><b>${v.toLocaleString('es-ES')}</b></button>`).join('');}
  function yearBand(y){const n=parseInt(y,10);if(!Number.isFinite(n))return 'Sin año';const d=Math.floor(n/10)*10;return d+'–'+(d+9);}
  async function view(){
    const rows=await allStore('comics'), purchases=await allStore('purchases');
    const inc=rows.filter(x=>x.status==='In Collection'), wish=rows.filter(x=>x.status==='On Wish List');
    const collections={}; rows.forEach(x=>{if(x.status!=='In Collection'&&x.status!=='On Wish List')return;const k=ckey(x);if(!collections[k])collections[k]={sample:x,have:0,total:0};collections[k].total++;if(x.status==='In Collection')collections[k].have++;});
    const cs=Object.values(collections), complete=cs.filter(x=>x.total&&x.have===x.total).length, pct=cs.length?Math.round(100*complete/cs.length):0;
    const paid=inc.reduce((s,x)=>s+num(x.paid),0), estimated=inc.reduce((s,x)=>s+num(x.estimated),0);
    const pubs=countBy(inc,x=>x.publisher).slice(0,10), groups=countBy(inc,x=>x.group||'Sin grupo').slice(0,10), decades=countBy(inc,x=>yearBand(x.startYear)).slice(0,10);
    const recent=[...purchases].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,6);
    return head('Dashboard','Visión ejecutiva e interactiva de tu comicoteca.',`<button class="btn primary" onclick="editComic()">+ Añadir cómic</button>`)+`<div class="pbi-shell">
      <div class="pbi-kpis">
        <button onclick="PbiDashboard.goto('catalog','In Collection')"><span>En colección</span><b>${inc.length.toLocaleString('es-ES')}</b><small>Cómics registrados</small></button>
        <button onclick="PbiDashboard.goto('wishlist')"><span>Wishlist</span><b>${wish.length.toLocaleString('es-ES')}</b><small>Pendientes / deseados</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Colecciones</span><b>${cs.length.toLocaleString('es-ES')}</b><small>${complete.toLocaleString('es-ES')} completas</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Completitud</span><b>${pct}%</b><small>Series completas</small></button>
        <div><span>Invertido</span><b>${money(paid)}</b><small>Precio pagado registrado</small></div>
        <div><span>Valor estimado</span><b>${money(estimated)}</b><small>Diferencia ${money(estimated-paid)}</small></div>
      </div>
      <div class="pbi-grid">
        <section class="pbi-panel"><div class="pbi-title"><b>Editoriales</b><span>Selecciona para filtrar catálogo</span></div>${barRows(pubs,'publisher')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Universos / grupos</b><span>Distribución de la colección</span></div>${barRows(groups,'group')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Décadas</b><span>Año de inicio de colección</span></div>${barRows(decades,'decade')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Últimas compras</b><span>${purchases.length.toLocaleString('es-ES')} registradas</span></div><div class="pbi-purchases">${recent.map(x=>`<div><span>${esc([x.publisher,x.series,x.issue&&('#'+x.issue)].filter(Boolean).join(' · ')||'Compra')}</span><b>${money(num(x.price)+num(x.shipping))}</b><small>${esc(x.date||'Sin fecha')}</small></div>`).join('')||'<div class="muted">Sin compras registradas</div>'}</div><button class="btn sm" onclick="PbiDashboard.goto('purchases')">Ver compras</button></section>
      </div>
    </div>`;
  }
  async function goto(v,status){await route(v);if(status&&v==='catalog'){filters.status=status;await render();}}
  async function filter(kind,value){const v=decodeURIComponent(value);if(kind==='publisher'){current='catalog';page=1;filters={publisher:v,status:'In Collection'};setNav('catalog');await render();return;}if(kind==='group'){current='catalog';page=1;filters={group:v,status:'In Collection'};setNav('catalog');await render();return;}if(kind==='decade'){current='catalog';page=1;filters={status:'In Collection',q:v.split('–')[0]};setNav('catalog');await render();}}
  window.PbiDashboard={view,goto,filter};
  window.dashboard=view;
})();