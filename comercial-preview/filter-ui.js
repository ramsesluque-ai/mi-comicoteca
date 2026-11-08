'use strict';
/* Filtros visuales: presentación únicamente. No modifica la lógica de búsqueda de datos/portadas. */
function mcVFCard(cls,icon,label,control){return `<label class="vf-card ${cls}"><span class="vf-label"><span class="ico">${icon}</span>${label}</span>${control}</label>`}
function mcVFSelect(rows,field,placeholder,value){return filtOpts(rows,field,placeholder,value||'')}
function mcVFChips(){
  const labels={q:'Buscar',publisher:'Editorial',catalogHeader:'Cabecera',volume:'Volumen',stage:'Etapa',startYear:'Año',status:'Estado',priority:'Prioridad'};
  const values=[];
  for(const k of ['q','publisher','catalogHeader','volume','stage','startYear','status','priority']){
    const v=filters[k];if(!v)continue;
    let text=v;if(v==='In Collection')text='En colección';if(v==='On Wish List')text='Wishlist';if(v==='__blank__')text='Sin estado';
    values.push(`<span class="vf-chip"><span>${labels[k]}</span><b>${esc(text)}</b></span>`);
  }
  return values.length?`<span class="vf-active-title">Activos</span>${values.join('')}`:`<span class="vf-empty">Sin filtros activos · se muestran todos los registros</span>`;
}
function mcVFPaint(){
  document.querySelectorAll('.vf-card').forEach(card=>{const el=card.querySelector('input,select');card.classList.toggle('active',!!String(el?.value||'').trim())});
  const row=document.getElementById('vf-active-row');if(row)row.innerHTML=mcVFChips();
}
function mcVFClear(scope){
  ['q','publisher','catalogHeader','volume','stage','startYear','status','priority'].forEach(k=>delete filters[k]);page=1;render();
}

catalogView=async function(wish=false){
  const rows=await allStore('comics'),byPub=rows.filter(x=>!filters.publisher||x.publisher===filters.publisher);
  const status=wish?mcVFSelect(rows,'priority','Todas las prioridades',filters.priority):`<select data-f="status"><option value="">Todos los estados</option><option value="In Collection" ${filters.status==='In Collection'?'selected':''}>En colección</option><option value="On Wish List" ${filters.status==='On Wish List'?'selected':''}>Wishlist</option></select>`;
  const filtersHtml=`<div class="filter-shell filter-shell-catalog"><div class="filter-toolbar"><div class="filter-toolbar-title"><div class="filter-toolbar-icon">◈</div><div><b>Filtros de ${wish?'Wishlist':'Catálogo'}</b><span>Combina editorial, cabecera, edición y estado para acotar la colección</span></div></div><button class="filter-clear" type="button" onclick="mcVFClear('catalog')">↺ Limpiar filtros</button></div><div class="visual-filters">
    ${mcVFCard('search vf-cyan','⌕','Buscar',`<input id="q" value="${esc(filters.q||'')}" placeholder="Título, serie, ISBN, personaje…">`)}
    ${mcVFCard('vf-purple','▦','Editorial',mcVFSelect(rows,'publisher','Todas las editoriales',filters.publisher))}
    ${mcVFCard('vf-indigo','▤','Cabecera / serie',mcVFSelect(byPub,'catalogHeader','Todas las cabeceras',filters.catalogHeader))}
    ${mcVFCard('vf-orange','◫','Volumen',mcVFSelect(rows,'volume','Todos los volúmenes',filters.volume))}
    ${mcVFCard('vf-pink','◆','Etapa',mcVFSelect(rows,'stage','Todas las etapas',filters.stage))}
    ${mcVFCard('vf-green','◷','Año de inicio',mcVFSelect(rows,'startYear','Todos los años',filters.startYear))}
    ${mcVFCard(wish?'vf-yellow':'vf-teal',wish?'★':'●',wish?'Prioridad':'Estado',status)}
  </div><div id="vf-active-row" class="vf-active-row">${mcVFChips()}</div></div>`;
  return head(wish?'Wishlist':'Catálogo',wish?'Deseos y faltantes, excluyendo colecciones completas y vendidos.':'Tu colección en fichas visuales, con filtros por edición y etapa.',`<button class="btn primary" onclick="editComic()">+ Añadir cómic</button>`)+`<div class="panel">${filtersHtml}<div id="catbody"></div></div>`;
};

const mcVFRenderCatBase=renderCat;
renderCat=async function(wish=false){await mcVFRenderCatBase(wish);mcVFPaint()};

seriesView=async function(){
  const r=await allStore('comics'),byPub=mcSeriesFilterRows(r,'publisher'),byHeader=mcSeriesFilterRows(r,'catalogHeader'),byVolume=mcSeriesFilterRows(r,'volume'),byStage=mcSeriesFilterRows(r,'stage');
  const sel=(field,label,rows)=>mcSeriesSelect(field,label,rows).replace(`data-f="${field}"`,`onchange="mcSeriesFilterChange('${field}',this.value)"`);
  const status=`<select onchange="mcSeriesStatusChange(this.value)"><option value="">Todos los estados</option><option value="In Collection" ${filters.status==='In Collection'?'selected':''}>En colección</option><option value="On Wish List" ${filters.status==='On Wish List'?'selected':''}>Wishlist</option><option value="__blank__" ${filters.status==='__blank__'?'selected':''}>Sin estado</option></select>`;
  const filtersHtml=`<div class="filter-shell filter-shell-series"><div class="filter-toolbar"><div class="filter-toolbar-title"><div class="filter-toolbar-icon">▦</div><div><b>Filtros de Colecciones</b><span>Navega por editorial, cabecera, volumen, etapa y año sin perder el contexto de la serie</span></div></div><button class="filter-clear" type="button" onclick="mcVFClear('series')">↺ Limpiar filtros</button></div><div class="visual-filters">
    ${mcVFCard('search vf-green','⌕','Buscar colección',`<input id="sq" value="${esc(filters.q||'')}" placeholder="Editorial, serie, etapa…">`)}
    ${mcVFCard('vf-purple','▦','Editorial',sel('publisher','Todas las editoriales',r))}
    ${mcVFCard('vf-indigo','▤','Cabecera / serie',sel('catalogHeader','Todas las cabeceras',byPub))}
    ${mcVFCard('vf-orange','◫','Volumen',sel('volume','Todos los volúmenes',byHeader))}
    ${mcVFCard('vf-pink','◆','Etapa',sel('stage','Todas las etapas',byVolume))}
    ${mcVFCard('vf-green','◷','Año de inicio',sel('startYear','Todos los años',byStage))}
    ${mcVFCard('vf-teal','●','Estado',status)}
  </div><div id="vf-active-row" class="vf-active-row">${mcVFChips()}</div></div>`;
  return head('Colecciones','Tus series agrupadas por Editorial + Cabecera + Volumen/Etapa + Año. El avance sigue de rojo a verde.')+`<div class="panel">${filtersHtml}<div id="seriesbody"></div></div>`;
};

const mcVFRenderSeriesBase=renderSeries;
renderSeries=async function(){await mcVFRenderSeriesBase();mcVFPaint()};
