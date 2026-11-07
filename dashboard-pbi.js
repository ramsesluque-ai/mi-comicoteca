'use strict';
(function(){
  let drill=null;
  const fmt=n=>(Number(n)||0).toLocaleString('es-ES');
  function countBy(rows,fn){const m={};rows.forEach(x=>{const k=String(fn(x)||'Sin dato').trim()||'Sin dato';m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  function splitPeople(v){return String(v||'').split(/[,;|\/]+/).map(x=>x.trim()).filter(Boolean);}
  function countMulti(rows,fields){const m={};rows.forEach(x=>{const people=new Set();fields.forEach(f=>{if(typeof x[f]==='string')splitPeople(x[f]).forEach(k=>people.add(k));});const roles=x.authors;if(roles&&typeof roles==='object'&&!Array.isArray(roles)){Object.values(roles).forEach(v=>{if(typeof v==='string')splitPeople(v).forEach(k=>people.add(k));else if(Array.isArray(v))v.forEach(entry=>{const name=typeof entry==='string'?entry:(entry&&typeof entry==='object'?(entry.name||entry.fullName||entry.nombre||''):'');splitPeople(name).forEach(k=>people.add(k));});});}people.forEach(k=>m[k]=(m[k]||0)+1);});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  function yearBand(y){const n=parseInt(y,10);if(!Number.isFinite(n))return 'Sin año';const d=Math.floor(n/10)*10;return d+'–'+(d+9);}
  function monthKey(v){const s=String(v||'');return /^\d{4}-\d{2}/.test(s)?s.slice(0,7):'';}
  function safeParam(value){return encodeURIComponent(value).replace(/'/g,'%27');}
  function bars(items,kind,limit=9){const a=items.slice(0,limit),mx=Math.max(1,...a.map(x=>x[1]));return a.map(([k,v])=>`<button class="pbi-bar-row" onclick="PbiDashboard.filter('${kind}','${safeParam(k)}')"><span class="pbi-label" title="${esc(k)}">${esc(k)}</span><span class="pbi-track"><i style="width:${Math.max(4,100*v/mx)}%"></i></span><b>${fmt(v)}</b></button>`).join('')+(items.length>limit?`<details class="pbi-all-groups"><summary>Ver los ${fmt(items.length)} grupos</summary>${bars(items.slice(limit),kind,items.length)}</details>`:'');}
  function collectionProgress(items){return items.slice(0,10).map(x=>{const pct=x.total?Math.min(100,Math.round(100*x.have/x.total)):0,s=x.sample||{};return `<button class="pbi-progress-row" onclick="PbiDashboard.openCollection('${safeParam(x.key)}')"><span><b>${esc(s.catalogHeader||s.series||'Colección')}</b><small>${esc([s.publisher,s.volume,s.stage,s.startYear].filter(Boolean).join(' · '))}</small></span><span class="pbi-progress ${pct>=100?'pbi-complete':pct>=75?'pbi-high':pct>=50?'pbi-medium':pct>=25?'pbi-low':'pbi-critical'}"><i style="width:${pct}%"></i></span><strong>${pct}%</strong></button>`}).join('');}
  function qualityCard(label,value,total,action){const pct=total?Math.round(value*100/total):0;return `<button class="pbi-quality" onclick="${action}"><span>${label}</span><b>${fmt(value)}</b><small>${pct}% del catálogo</small><i><em style="width:${pct}%"></em></i></button>`;}
  function monthBars(purchases){const m={};purchases.forEach(x=>{const k=monthKey(x.date);if(k)m[k]=(m[k]||0)+num(x.price)+num(x.shipping)});const a=Object.entries(m).sort((a,b)=>a[0].localeCompare(b[0])).slice(-12),mx=Math.max(1,...a.map(x=>x[1]));return `<div class="pbi-months">${a.map(([k,v])=>`<div title="${k}: ${money(v)}"><i style="height:${Math.max(5,100*v/mx)}%"></i><small>${k.slice(5)}</small></div>`).join('')||'<span class="muted">Sin compras fechadas</span>'}</div>`;}
  function universeName(x){return String(x.universe||'').trim()||'Sin identificar';}
  function characterName(x){return String(x.character||'').trim()||'Sin identificar';}
  function drillRows(rows){
    if(!drill)return rows;
    return rows.filter(x=>drill.kind==='publisher'?String(x.publisher||'Sin dato').trim()===drill.value:drill.kind==='universe'?universeName(x)===drill.value:characterName(x)===drill.value);
  }
  function drillPanel(rows){
    if(!drill)return '';
    const selected=drillRows(rows),owned=selected.filter(x=>x.status==='In Collection'),wish=selected.filter(x=>x.status==='On Wish List');
    const secondary=drill.kind==='publisher'?countBy(owned,characterName):drill.kind==='universe'?countBy(owned,characterName):countBy(owned,universeName);
    const seriesMap=new Map();
    owned.forEach(x=>{const key=ckey(x);if(!seriesMap.has(key))seriesMap.set(key,{key,sample:x,count:0});seriesMap.get(key).count++;});
    const series=[...seriesMap.values()].sort((a,b)=>b.count-a.count);
    const heading=drill.kind==='publisher'?'Editorial':drill.kind==='universe'?'Universo':'Personaje';
    const details=owned.map(x=>`<tr><td>${esc(x.publisher||'Sin dato')}</td><td>${esc(x.catalogHeader||x.series||'Sin cabecera')}</td><td>${esc(x.volume||x.stage||'—')}</td><td>${esc(x.issueNr??x.issue??x.number??'—')}</td><td>${esc(x.title||'Sin título acreditado')}</td></tr>`).join('');
    return `<section class="pbi-drill" aria-label="Desglose interactivo"><div class="pbi-drill-head"><div><small>DESGLOSE · ${heading}</small><h2>${esc(drill.value)}</h2><p>Explora los datos sin salir del dashboard. Las cifras reflejan los registros actuales.</p></div><button class="btn sm" onclick="PbiDashboard.clearDrill()">✕ Cerrar desglose</button></div>
      <div class="pbi-drill-kpis"><div><small>En colección</small><b>${fmt(owned.length)}</b></div><div><small>Wishlist</small><b>${fmt(wish.length)}</b></div><div><small>Series / etapas</small><b>${fmt(series.length)}</b></div><div><small>Editoriales</small><b>${fmt(countBy(owned,x=>x.publisher).length)}</b></div></div>
      <div class="pbi-drill-grid"><div><h3>${drill.kind==='character'?'Universos':'Personajes'}</h3>${bars(secondary,drill.kind==='character'?'universe':'character',12)||'<p class="muted">Sin datos</p>'}</div><div><h3>Series y etapas</h3>${series.map(item=>`<button type="button" class="pbi-drill-series pbi-series-link" onclick="PbiDashboard.openCollection('${safeParam(item.key)}')" title="Abrir colección"><span>${esc([item.sample.publisher,item.sample.catalogHeader||item.sample.series||'Sin cabecera',item.sample.volume||item.sample.stage||'Sin etapa',item.sample.startYear||'Sin año'].join(' · '))}</span><b>${fmt(item.count)} ↗</b></button>`).join('')||'<p class="muted">Sin datos</p>'}</div></div>
      <details class="pbi-drill-table"><summary>Ver todos los ejemplares (${fmt(owned.length)})</summary><div class="pbi-drill-scroll"><table><thead><tr><th>Editorial</th><th>Cabecera</th><th>Volumen / etapa</th><th>N.º</th><th>Título</th></tr></thead><tbody>${details}</tbody></table></div></details>
    </section>`;
  }
  function clearDrill(){drill=null;if(typeof render==='function')return render();}
  async function view(){
    const rows=await allStore('comics'),purchases=await allStore('purchases');
    const inc=rows.filter(x=>x.status==='In Collection'),wish=rows.filter(x=>x.status==='On Wish List');
    // Count distinct issue identities, not duplicate personal records. A collection is
    // only "complete" when a documented Maestro total exists.
    const master=await allStore('master');
    const collections={};
    const issueKey=x=>String(x.issueNr??x.issue??x.number??'').trim();
    const masterIssues={};
    master.forEach(x=>{const k=ckey(x),n=issueKey(x);if(n){if(!masterIssues[k])masterIssues[k]=new Set();masterIssues[k].add(n);}});
    rows.forEach(x=>{if(!['In Collection','On Wish List'].includes(x.status))return;const k=ckey(x);if(!collections[k])collections[k]={key:k,sample:x,owned:new Set(),personal:new Set(),have:0,total:0};const n=issueKey(x);if(n){collections[k].personal.add(n);if(x.status==='In Collection')collections[k].owned.add(n);}});
    Object.values(collections).forEach(x=>{x.have=x.owned.size;x.total=masterIssues[x.key]?.size||0;});
    const cs=Object.values(collections),known=cs.filter(x=>x.total>0),complete=known.filter(x=>x.have>=x.total).length,incomplete=known.length-complete,unknown=cs.length-known.length,pct=known.length?Math.round(100*complete/known.length):0;
    const estimated=inc.reduce((s,x)=>s+num(x.estimated),0),now=new Date(),mk=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0'),monthPurchases=purchases.filter(x=>monthKey(x.date)===mk),monthSpend=monthPurchases.reduce((s,x)=>s+num(x.price)+num(x.shipping),0);
    const pubs=countBy(inc,x=>x.publisher),characters=countBy(inc,characterName),universes=countBy(inc,universeName),authors=countMulti(inc,['writer','writers','script','author','authors','artist','artists','penciller']),decades=countBy(inc,x=>yearBand(x.startYear||x.year));
    const recent=[...purchases].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,6),progress=[...cs].filter(x=>x.total).sort((a,b)=>(b.total-b.have)-(a.total-a.have)||b.total-a.total);
    const noCover=inc.filter(x=>!(x.cover||x.coverUrl||x.image||x.imageUrl)).length,noIsbn=inc.filter(x=>!(x.isbn||x.ISBN)).length,lowQuality=inc.filter(x=>String(x.quality||'').toLowerCase().includes('baj')||String(x.condition||'').toLowerCase().includes('poor')).length;
    return head('Dashboard','Centro de control interactivo de tu comicoteca.',`<button class="btn primary" onclick="editComic()">+ Añadir cómic</button>`)+`<div class="pbi-shell">
      <div class="pbi-kpis">
        <button onclick="PbiDashboard.goto('catalog','In Collection')"><span>En colección</span><b>${fmt(inc.length)}</b><small>Cómics registrados</small></button>
        <button onclick="PbiDashboard.goto('wishlist')"><span>Wishlist</span><b>${fmt(wish.length)}</b><small>Pendientes / deseados</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Colecciones</span><b>${fmt(cs.length)}</b><small>${fmt(complete)} completas · ${fmt(incomplete)} incompletas · ${fmt(unknown)} sin total acreditado</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Completitud</span><b>${pct}%</b><small>Series con total conocido</small></button>
        <div><span>Valor estimado</span><b>${money(estimated)}</b><small>Valor registrado</small></div>
        <button onclick="PbiDashboard.goto('purchases')"><span>Compras del mes</span><b>${fmt(monthPurchases.length)}</b><small>${money(monthSpend)} este mes</small></button>
      </div>
      ${drillPanel(rows)}
      <div class="pbi-grid pbi-grid-3">
        <section class="pbi-panel"><div class="pbi-title"><b>Editoriales</b><span>Clic para filtrar</span></div>${bars(pubs,'publisher')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Personajes</b><span>Personajes y equipos registrados</span></div>${bars(characters,'character')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Universos</b><span>Clasificación independiente</span></div>${bars(universes,'universe')||'<div class="muted">Sin datos</div>'}</section>
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
  async function filter(kind,value){const v=decodeURIComponent(value);if(kind==='publisher'||kind==='character'||kind==='universe'){drill={kind,value:v};if(typeof render==='function')await render();return;}current='catalog';page=1;filters={status:'In Collection'};if(kind==='author')filters.q=v;else if(kind==='decade')filters.q=v.split('–')[0];setNav('catalog');await render();}
  async function openCollection(encoded){const key=decodeURIComponent(encoded);current='series';page=1;setNav('series');await render();if(typeof openSeries==='function')return openSeries(encodeURIComponent(key));if(typeof window.openCollection==='function' && window.openCollection!==window.PbiDashboard.openCollection)return window.openCollection(encodeURIComponent(key));}
  window.PbiDashboard={view,goto,filter,openCollection,clearDrill};
  window.dashboard=view;

  // app1/app5 can start their initial asynchronous render before this module loads.
  // Re-render the active dashboard once the complete script chain has installed
  // the BI implementation. Never redirect a user who has already navigated away.
  function activateDashboard(){
    if(typeof current!=='undefined' && current==='dashboard' && typeof render==='function'){
      Promise.resolve().then(()=>render()).catch(err=>{
        console.error('No se pudo iniciar el dashboard BI',err);
      });
    }
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',activateDashboard,{once:true});
  }else{
    activateDashboard();
  }
})();