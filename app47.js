'use strict';
/* v68: segmentadores vinculados. Cada filtro recalcula las opciones válidas del resto. */
(function(){
  if(typeof allStore!=='function')return;
  const fields=['publisher','catalogHeader','volume','stage','startYear'];
  function rowsFor(base,exclude,wish=false){
    let a=base;
    if(wish)a=a.filter(x=>x.status==='On Wish List'&&!hasTag(x,'Completa')&&!hasTag(x,'Vendido'));
    else if(filters.status)a=a.filter(x=>x.status===filters.status);
    if(filters.priority&&exclude!=='priority')a=a.filter(x=>String(x.priority||'')===String(filters.priority));
    for(const k of fields){if(k===exclude||!filters[k])continue;a=a.filter(x=>String(x[k]??'')===String(filters[k]))}
    if(filters.q){const q=norm(filters.q);a=a.filter(x=>norm([x.publisher,x.series,x.catalogHeader,x.volume,x.stage,x.startYear,x.issueNr,x.title,x.subtitle,x.group,x.arc,x.isbn].join(' ')).includes(q))}
    return a;
  }
  function linkedSelect(base,field,label,wish=false){
    let vals=uniq(rowsFor(base,field,wish),field),cur=String(filters[field]||'');
    if(cur&&!vals.includes(cur))vals=[cur,...vals];
    return `<select data-f="${field}"><option value="">${label}</option>${vals.map(x=>`<option ${x===cur?'selected':''}>${esc(x)}</option>`).join('')}</select>`;
  }
  function linkedBind(repaint,wish=false){
    $$('[data-f]').forEach(el=>el.onchange=async()=>{const k=el.dataset.f,v=el.value;if(v)filters[k]=v;else delete filters[k];page=1;await render();});
    const q=$('#q');if(q)q.oninput=()=>{filters.q=q.value;page=1;clearTimeout(window.__mcLinkedQ);window.__mcLinkedQ=setTimeout(()=>render(),180)};
  }
  window.bindFilters=bindFilters=linkedBind;

  window.catalogView=catalogView=async function(wish=false){
    const rows=await allStore('comics');
    const status=wish?linkedSelect(rows,'priority','Todas las prioridades',true):`<select data-f="status"><option value="">Todos los estados</option><option value="In Collection" ${filters.status==='In Collection'?'selected':''}>En colección</option><option value="On Wish List" ${filters.status==='On Wish List'?'selected':''}>Wishlist</option></select>`;
    const card=(cls,icon,label,control)=>typeof mcVFCard==='function'?mcVFCard(cls,icon,label,control):control;
    const chips=()=>typeof mcVFChips==='function'?mcVFChips():'';
    const fh=`<div class="filter-shell filter-shell-catalog"><div class="filter-toolbar"><div class="filter-toolbar-title"><div class="filter-toolbar-icon">◈</div><div><b>Filtros de ${wish?'Wishlist':'Catálogo'}</b><span>Todos los filtros están vinculados: cada selección limita las opciones compatibles del resto</span></div></div><button class="filter-clear" type="button" onclick="mcVFClear('catalog')">↺ Limpiar filtros</button></div><div class="visual-filters">
    ${card('search vf-cyan','⌕','Buscar',`<input id="q" value="${esc(filters.q||'')}" placeholder="Título, serie, ISBN, personaje…">`)}
    ${card('vf-purple','▦','Editorial',linkedSelect(rows,'publisher','Todas las editoriales',wish))}
    ${card('vf-indigo','▤','Cabecera / serie',linkedSelect(rows,'catalogHeader','Todas las cabeceras',wish))}
    ${card('vf-orange','◫','Volumen',linkedSelect(rows,'volume','Todos los volúmenes',wish))}
    ${card('vf-pink','◆','Etapa',linkedSelect(rows,'stage','Todas las etapas',wish))}
    ${card('vf-green','◷','Año de inicio',linkedSelect(rows,'startYear','Todos los años',wish))}
    ${card(wish?'vf-yellow':'vf-teal',wish?'★':'●',wish?'Prioridad':'Estado',status)}
    </div><div id="vf-active-row" class="vf-active-row">${chips()}</div></div>`;
    return head(wish?'Wishlist':'Catálogo',wish?'Deseos y faltantes, excluyendo colecciones completas y vendidos.':'Tu colección en fichas visuales, con filtros vinculados por edición y etapa.',`<button class="btn primary" onclick="editComic()">+ Añadir cómic</button>`)+`<div class="panel">${fh}<div id="catbody"></div></div>`;
  };

  window.masterView=masterView=async function(){
    const m=await allStore('master');if(!m.length)return head('Maestro','Catálogo maestro independiente de tu colección.')+`<div class="notice"><b>Maestro vacío.</b></div>`;
    const sel=(f,l)=>linkedSelect(m,f,l,false);
    return head('Maestro','Colecciones externas; los filtros se cruzan entre sí para mostrar únicamente combinaciones existentes.')+`<div class="panel"><div class="filters"><input id="mq" value="${esc(filters.q||'')}" placeholder="Buscar cabecera, título, ISBN…">${sel('publisher','Todas las editoriales')}${sel('catalogHeader','Todas las cabeceras')}${sel('volume','Todos los volúmenes')}${sel('stage','Todas las etapas')}${sel('startYear','Todos los años')}<label class="small checkline"><input id="showOwned" type="checkbox" ${filters.showOwned?'checked':''}> Mostrar ya presentes</label></div><div id="masterbody"></div></div>`;
  };

  const oldRenderCat=window.renderCat;
  if(typeof oldRenderCat==='function')window.renderCat=renderCat=async function(wish=false){const r=await oldRenderCat(wish);linkedBind(()=>render(),wish);try{mcVFPaint?.()}catch{}return r};
  const oldRenderMaster=window.renderMaster;
  if(typeof oldRenderMaster==='function')window.renderMaster=renderMaster=async function(...a){const r=await oldRenderMaster(...a);$$('[data-f]').forEach(el=>el.onchange=async()=>{const k=el.dataset.f;if(el.value)filters[k]=el.value;else delete filters[k];page=1;await render()});const q=$('#mq');if(q)q.oninput=()=>{filters.q=q.value;page=1;clearTimeout(window.__mcLinkedMQ);window.__mcLinkedMQ=setTimeout(()=>render(),180)};return r};
})();
