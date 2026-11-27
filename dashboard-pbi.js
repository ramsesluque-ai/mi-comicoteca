'use strict';
(function(){
  let drill=null;
  const fmt=n=>(Number(n)||0).toLocaleString('es-ES');
  function countBy(rows,fn){const m={};rows.forEach(x=>{const k=String(fn(x)||'Sin dato').trim()||'Sin dato';m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  function splitPeople(v){return String(v||'').split(/[,;|\/]+/).map(x=>x.trim()).filter(Boolean);}
  function countMulti(rows,fields){const m={};rows.forEach(x=>{const people=new Set();fields.forEach(f=>{if(typeof x[f]==='string')splitPeople(x[f]).forEach(k=>people.add(k));});const roles=x.authors;if(roles&&typeof roles==='object'){(Array.isArray(roles)?roles:Object.values(roles)).forEach(v=>{if(typeof v==='string')splitPeople(v).forEach(k=>people.add(k));else if(Array.isArray(v))v.forEach(entry=>{const name=typeof entry==='string'?entry:(entry&&typeof entry==='object'?(entry.name||entry.fullName||entry.nombre||''):'');splitPeople(name).forEach(k=>people.add(k));});else if(v&&typeof v==='object')splitPeople(v.name||v.fullName||v.nombre||'').forEach(k=>people.add(k));});}people.forEach(k=>m[k]=(m[k]||0)+1);});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  function yearBand(y){const n=parseInt(y,10);if(!Number.isFinite(n))return 'Sin año';const d=Math.floor(n/10)*10;return d+'–'+(d+9);}
  function monthKey(v){const s=String(v||'');return /^\d{4}-\d{2}/.test(s)?s.slice(0,7):'';}
  function safeParam(value){return encodeURIComponent(value).replace(/'/g,'%27');}
  function bars(items,kind,limit=9){const a=items.slice(0,limit),mx=Math.max(1,...a.map(x=>x[1]));return a.map(([k,v])=>`<button class="pbi-bar-row" onclick="PbiDashboard.filter('${kind}','${safeParam(k)}')"><span class="pbi-label" title="${esc(k)}">${esc(k)}</span><span class="pbi-track"><i style="width:${Math.max(4,100*v/mx)}%"></i></span><b>${fmt(v)}</b></button>`).join('')+(items.length>limit?`<details class="pbi-all-groups"><summary>Ver los ${fmt(items.length)} grupos</summary>${bars(items.slice(limit),kind,items.length)}</details>`:'');}
  function collectionProgress(items){return items.slice(0,10).map(x=>{const pct=x.total?Math.min(100,Math.round(100*(x.total-x.missing)/x.total)):0,s=x.sample||{};return `<button class="pbi-progress-row" onclick="PbiDashboard.openCollection('${safeParam(x.key)}')"><span><b>${esc(s.catalogHeader||s.series||'Colección')}</b><small>${esc([s.publisher,s.volume,s.stage,s.startYear].filter(Boolean).join(' · '))}</small></span><span class="pbi-progress ${pct>=100?'pbi-complete':pct>=75?'pbi-high':pct>=50?'pbi-medium':pct>=25?'pbi-low':'pbi-critical'}"><i style="width:${pct}%"></i></span><strong>${fmt(x.missing)} por conseguir · ${pct}%</strong></button>`}).join('');}
  function qualityCard(label,value,total,action){const pct=total?Math.round(value*100/total):0;return `<button class="pbi-quality" onclick="${action}"><span>${label}</span><b>${fmt(value)}</b><small>${pct}% del catálogo</small><i><em style="width:${pct}%"></em></i></button>`;}
  function monthBars(purchases){const m={};purchases.forEach(x=>{const k=monthKey(x.date);if(k)m[k]=(m[k]||0)+num(x.price)+num(x.shipping)});const a=Object.entries(m).sort((a,b)=>a[0].localeCompare(b[0])).slice(-12),mx=Math.max(1,...a.map(x=>x[1]));return `<div class="pbi-months">${a.map(([k,v])=>`<div title="${k}: ${money(v)}"><i style="height:${Math.max(5,100*v/mx)}%"></i><small>${k.slice(5)}</small></div>`).join('')||'<span class="muted">Sin compras fechadas</span>'}</div>`;}
  // Universe and protagonist are independent classifications. Historical
  // group values remain untouched and are never counted in either category.
  function universeName(x){
    return String(x.universe||'').trim()||'Sin identificar';
  }
  function characterName(x){
    return String(x.character||'').trim()||'Sin identificar';
  }
  function drillRows(rows){
    if(!drill)return rows;
    return rows.filter(x=>drill.kind==='publisher'?String(x.publisher||'Sin dato').trim()===drill.value:drill.kind==='universe'?universeName(x)===drill.value:drill.kind==='author'?countMulti([x],['writer','writers','script','author','authors','artist','artists','penciller']).some(([name])=>name===drill.value):drill.kind==='decade'?yearBand(x.startYear||x.year)===drill.value:characterName(x)===drill.value);
  }
  function drillPanel(rows){
    if(!drill)return '';
    const selected=drillRows(rows),owned=selected.filter(x=>x.status==='In Collection'),wish=selected.filter(x=>x.status==='On Wish List');
    const secondary=drill.kind==='publisher'?countBy(owned,characterName):drill.kind==='universe'?countBy(owned,characterName):countBy(owned,universeName);
    const seriesMap=new Map();
    owned.forEach(x=>{const key=ckey(x);if(!seriesMap.has(key))seriesMap.set(key,{key,sample:x,count:0});seriesMap.get(key).count++;});
    const series=[...seriesMap.values()].sort((a,b)=>b.count-a.count);
    const heading=({publisher:'Editorial',universe:'Universo',character:'Personaje',author:'Autor',decade:'Década'})[drill.kind]||'Filtro';
    const details=owned.map(x=>`<tr><td>${esc(x.publisher||'Sin dato')}</td><td>${esc(x.catalogHeader||x.series||'Sin cabecera')}</td><td>${esc(x.volume||x.stage||'—')}</td><td>${esc(x.issueNr??x.issue??x.number??'—')}</td><td>${esc(x.title||'Sin título acreditado')}</td></tr>`).join('');
    return `<section class="pbi-drill" aria-label="Desglose interactivo"><div class="pbi-drill-head"><div><small>DESGLOSE · ${heading}</small><h2>${esc(drill.value)}</h2><p>Explora los datos sin salir del dashboard. Las cifras reflejan los registros actuales.</p></div><button class="btn sm" onclick="PbiDashboard.clearDrill()">✕ Cerrar desglose</button></div>
      <div class="pbi-drill-kpis"><div><small>En colección</small><b>${fmt(owned.length)}</b></div><div><small>Wishlist</small><b>${fmt(wish.length)}</b></div><div><small>Series / etapas</small><b>${fmt(series.length)}</b></div><div><small>Editoriales</small><b>${fmt(countBy(owned,x=>x.publisher).length)}</b></div></div>
      <div class="pbi-drill-grid"><div><h3>${drill.kind==='character'?'Universos':'Personajes'}</h3>${bars(secondary,drill.kind==='character'?'universe':'character',12)||'<p class="muted">Sin datos</p>'}</div><div><h3>Series y etapas</h3>${series.map(item=>`<button type="button" class="pbi-drill-series pbi-series-link" onclick="PbiDashboard.openCollection('${safeParam(item.key)}')" title="Abrir colección"><span>${esc([item.sample.publisher,item.sample.catalogHeader||item.sample.series||'Sin cabecera',item.sample.volume||item.sample.stage||'Sin etapa',item.sample.startYear||'Sin año'].join(' · '))}<small>Universo: ${esc(universeName(item.sample))} · Personaje: ${esc(characterName(item.sample))}</small></span><b>${fmt(item.count)} ↗</b></button>`).join('')||'<p class="muted">Sin datos</p>'}</div></div>
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
    // Merge bibliographic classification for display only; never rewrite personal
    // records or infer universe/character from the collection title.
    const masterByIssue=new Map(),masterByCollection=new Map();
    const issueNumber=x=>String(x.issueNr??x.issue??x.number??'').trim();
    const issueIdentity=x=>ckey(x)+'|'+issueNumber(x);
    const fields=['universe','character','group'];
    master.forEach(x=>{
      // An unnumbered bibliographic entry must not impersonate every other
      // unnumbered entry in the same collection.
      if(issueNumber(x))masterByIssue.set(issueIdentity(x),x);
      const key=ckey(x),entry=masterByCollection.get(key)||{values:{},conflicts:new Set()};
      fields.forEach(field=>{
        const value=String(x[field]||'').trim();
        if(!value)return;
        if(entry.values[field]&&entry.values[field]!==value)entry.conflicts.add(field);
        else if(!entry.values[field])entry.values[field]=value;
      });
      masterByCollection.set(key,entry);
    });
    // Only inherit a series-wide label when every documented nonempty label
    // agrees; conflicting classifications must remain unassigned.
    masterByCollection.forEach((entry,key)=>{
      const safe={};
      fields.forEach(field=>safe[field]=entry.conflicts.has(field)?'':(entry.values[field]||''));
      masterByCollection.set(key,safe);
    });
    const classifiedRows=rows.map(x=>{
      const exact=issueNumber(x)?(masterByIssue.get(issueIdentity(x))||{}):{};
      const series=masterByCollection.get(ckey(x))||{};
      return {...x,
        universe:String(x.universe||'').trim()||String(exact.universe||'').trim()||series.universe||'',
        character:String(x.character||'').trim()||String(exact.character||'').trim()||series.character||'',
        group:String(x.group||'').trim()||String(exact.group||'').trim()||series.group||'',
        // Bibliographic author credits belong to the exact issue. Enrich the
        // dashboard view only; never persist them into the user's collection.
        ...Object.fromEntries(['writer','writers','script','author','authors','artist','artists','penciller'].map(field=>[field,x[field]??exact[field]??'']))
      };
    });
    const classifiedOwned=classifiedRows.filter(x=>x.status==='In Collection');
    // Personal collection progress: only wishlist issues are missing.
    // The shared Maestro is NOT the user's purchase checklist.
    const collections=new Map();
    const issueKey=x=>String(x.issueNr??x.issue??x.number??'').trim();
    rows.forEach((x,index)=>{
      if(!['In Collection','On Wish List'].includes(x.status))return;
      const key=ckey(x);
      if(!collections.has(key))collections.set(key,{key,sample:x,owned:new Set(),wishlist:new Set()});
      const item=collections.get(key);
      const number=issueKey(x);
      // Use a stable record identity when no issue number is present.
      const identity=number?'n:'+number:'id:'+String(x.id??index);
      if(x.status==='In Collection')item.owned.add(identity);
      else item.wishlist.add(identity);
    });
    const cs=[...collections.values()].map(x=>{
      const missing=[...x.wishlist].filter(id=>!x.owned.has(id)).length;
      return {...x,have:x.owned.size,missing,total:x.owned.size+missing};
    });
    const complete=cs.filter(x=>x.missing===0).length,incomplete=cs.length-complete;
    const pct=cs.length?Math.round(100*complete/cs.length):0;
    const estimated=inc.reduce((s,x)=>s+num(x.estimated),0),now=new Date(),mk=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0'),monthPurchases=purchases.filter(x=>monthKey(x.date)===mk),monthSpend=monthPurchases.reduce((s,x)=>s+num(x.price)+num(x.shipping),0);
    const pubs=countBy(inc,x=>x.publisher),characters=countBy(classifiedOwned,characterName),universes=countBy(classifiedOwned,universeName),authors=countMulti(classifiedOwned,['writer','writers','script','author','authors','artist','artists','penciller']),decades=countBy(inc,x=>yearBand(x.startYear||x.year));
    const recent=[...purchases].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,6),progress=cs.filter(x=>x.missing>0).sort((a,b)=>a.missing-b.missing||b.have-a.have||String(a.key).localeCompare(String(b.key)));
    const noCover=inc.filter(x=>!(x.coverKey||x.cover||x.coverUrl||x.image||x.imageUrl)).length,noIsbn=inc.filter(x=>!(x.isbn||x.ISBN)).length,lowQuality=inc.filter(x=>String(x.quality||'').toLowerCase().includes('baj')||String(x.condition||'').toLowerCase().includes('poor')).length;
    return head('Dashboard','Centro de control interactivo de tu comicoteca.',`<button class="btn primary" onclick="editComic()">+ Añadir cómic</button>`)+`<div class="pbi-shell">
      <div class="pbi-kpis">
        <button onclick="PbiDashboard.goto('catalog','In Collection')"><span>En colección</span><b>${fmt(inc.length)}</b><small>Cómics registrados</small></button>
        <button onclick="PbiDashboard.goto('wishlist')"><span>Wishlist</span><b>${fmt(wish.length)}</b><small>Pendientes / deseados</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Colecciones</span><b>${fmt(cs.length)}</b><small>${fmt(complete)} completas · ${fmt(incomplete)} incompletas · ${fmt(incomplete)} con números en wishlist</small></button>
        <button onclick="PbiDashboard.goto('series')"><span>Completitud</span><b>${fmt(complete)} / ${fmt(cs.length)}</b><small>${pct}% de colecciones sin números pendientes en wishlist</small></button>
        <div><span>Valor estimado</span><b>${money(estimated)}</b><small>Valor registrado</small></div>
        <button onclick="PbiDashboard.goto('purchases')"><span>Compras del mes</span><b>${fmt(monthPurchases.length)}</b><small>${money(monthSpend)} este mes</small></button>
      </div>
      ${drillPanel(classifiedRows)}
      <div class="pbi-grid pbi-grid-3">
        <section class="pbi-panel"><div class="pbi-title"><b>Editoriales</b><span>Clic para filtrar</span></div>${bars(pubs,'publisher')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Personajes</b><span>Clasificación específica · sin identificar si falta</span></div>${bars(characters,'character')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Universos</b><span>Clasificación específica · sin identificar si falta</span></div>${bars(universes,'universe')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Autores</b><span>Guionistas y artistas</span></div>${bars(authors,'author')||'<div class="muted">Sin datos de autores</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Décadas</b><span>Año de inicio</span></div>${bars(decades,'decade')||'<div class="muted">Sin datos</div>'}</section>
        <section class="pbi-panel"><div class="pbi-title"><b>Evolución de compras</b><span>Gasto · últimos 12 meses</span></div>${monthBars(purchases)}<button class="btn sm" onclick="PbiDashboard.goto('purchases')">Abrir compras</button></section>
        <section class="pbi-panel"><div class="pbi-title"><b>Calidad del catálogo</b><span>Pendientes de completar</span></div><div class="pbi-quality-grid">${qualityCard('Sin portada',noCover,inc.length,"PbiDashboard.goto('covers')")}${qualityCard('Sin ISBN',noIsbn,inc.length,"PbiDashboard.goto('quality')")}${qualityCard('Calidad baja',lowQuality,inc.length,"PbiDashboard.goto('quality')")}</div></section>
        <section class="pbi-panel pbi-wide"><div class="pbi-title"><b>Colecciones más próximas a completar</b><span>Números pendientes según tu wishlist · 1, 2, 3…</span></div><div class="pbi-progress-list">${collectionProgress(progress)||'<div class="muted">No hay colecciones con números pendientes en wishlist</div>'}</div></section>
        <section class="pbi-panel"><div class="pbi-title"><b>Últimas compras</b><span>${fmt(purchases.length)} registradas</span></div><div class="pbi-purchases">${recent.map(x=>`<div><span>${esc([x.publisher,x.series,x.issue&&('#'+x.issue)].filter(Boolean).join(' · ')||'Compra')}</span><b>${money(num(x.price)+num(x.shipping))}</b><small>${esc(x.date||'Sin fecha')}</small></div>`).join('')||'<div class="muted">Sin compras registradas</div>'}</div></section>
      </div>
    </div>`;
  }
  async function goto(v,status){await route(v);if(status&&v==='catalog'){filters.status=status;await render();}}
  async function filter(kind,value){const v=decodeURIComponent(value);if(['publisher','character','universe','author','decade'].includes(kind)){drill={kind,value:v};if(typeof render==='function')await render();return;}current='catalog';page=1;filters={status:'In Collection'};if(kind==='author')filters.q=v;else if(kind==='decade')filters.q=v.split('–')[0];setNav('catalog');await render();}
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
        const target=document.getElementById('view');
        if(target && typeof current!=='undefined' && current==='dashboard'){
          const notice=document.createElement('div');
          notice.setAttribute('role','alert');
          notice.className='card';
          notice.style.cssText='margin:20px;padding:20px;border:1px solid #e9a23b';
          const heading=document.createElement('h2');
          heading.textContent='No se ha podido cargar el dashboard BI';
          const message=document.createElement('p');
          message.textContent='Tus datos no se han modificado. Recarga la página; si el problema continúa, consulta la consola del navegador.';
          notice.append(heading,message);
          target.replaceChildren(notice);
        }
      });
    }
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',activateDashboard,{once:true});
  }else{
    activateDashboard();
  }
})();