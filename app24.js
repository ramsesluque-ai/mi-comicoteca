'use strict';
/* v34: gestor seguro de portadas por filtros, selección y lotes para catálogos grandes. */
(function(){
  const MAX_SELECT=500,MAX_RUN=250,PER_PAGE=60;
  const order=['publisher','catalogHeader','volume','stage','startYear'];
  const f={q:'',publisher:'',catalogHeader:'',volume:'',stage:'',startYear:'',status:'',coverState:'missing'};
  const selected=new Set();
  let coverPage=1,running=false,stopRequested=false,lastProgress='',lastFilteredIds=[];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const code=v=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const issue=v=>String(v??'').trim();
  const val=(x,k)=>k==='catalogHeader'?String(x.catalogHeader||x.series||''):String(x[k]??'');
  const encId=id=>encodeURIComponent(String(id??''));
  const decId=id=>decodeURIComponent(String(id??''));
  const hasExternal=x=>/^https:\/\//i.test(String(x?.coverUrl||''))||/^data:image\//i.test(String(x?.coverUrl||''));

  function escOpt(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function byStatus(rows){if(!f.status)return rows;if(f.status==='__blank__')return rows.filter(x=>!x.status);return rows.filter(x=>x.status===f.status)}
  function byCover(rows){return rows.filter(x=>!x.coverKey)}
  function filterCore(rows,includeSearch=true){let a=byStatus(rows);for(const k of order)if(f[k])a=a.filter(x=>val(x,k)===String(f[k]));if(includeSearch&&f.q){const q=norm(f.q);a=a.filter(x=>norm([x.publisher,x.catalogHeader,x.series,x.volume,x.stage,x.startYear,x.title,x.issueNr,x.isbn].join(' ')).includes(q))}return byCover(a)}
  function rowsBefore(rows,field){let a=byCover(byStatus(rows));for(const k of order){if(k===field)break;if(f[k])a=a.filter(x=>val(x,k)===String(f[k]))}return a}
  function values(rows,field){return [...new Set(rows.map(x=>val(x,field)).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es',{numeric:true,sensitivity:'base'}))}
  function selectHtml(id,label,vals,current){return `<select id="${id}" ${running?'disabled':''} onchange="AutoCover.setFilter('${id}',this.value)"><option value="">${label}</option>${vals.map(v=>`<option value="${escOpt(v)}" ${String(current)===String(v)?'selected':''}>${escOpt(v)}</option>`).join('')}</select>`}
  function locked(){if(!running)return false;toast('Detén primero el lote de portadas');return true}
  function clearSelected(){selected.clear();updateSelectedCount()}

  function safeCandidate(x,c){
    const d=c?.data||{};if(!d.coverUrl)return false;
    const xc=code(x.isbn),dc=code(d.isbn);if(xc&&dc&&xc===dc)return true;
    if(!issue(x.issueNr??x.issue)||!issue(d.issueNr)||!mcSEIssueExact(issue(x.issueNr??x.issue),issue(d.issueNr)))return false;
    if(x.publisher&&d.publisher&&!mcSEPubCompatible(x.publisher,d.publisher))return false;
    if((x.catalogHeader||x.series)&&d.series&&mcSESeriesScore(x.catalogHeader||x.series,d.series)<0.90)return false;
    if(x.startYear&&d.startYear&&String(x.startYear)!==String(d.startYear))return false;
    return Number(c.score||0)>=9000;
  }
  async function candidateFor(x){
    if(hasExternal(x))return{source:'asociada',data:{coverUrl:x.coverUrl,coverUrls:[x.coverUrl]}};
    const list=typeof mcSESearch==='function'?await mcSESearch(x):[];
    return(list||[]).find(c=>safeCandidate(x,c))||null;
  }
  async function attach(x,c){if(c.source==='asociada')return CoverVault.attach(x,c.data.coverUrl);if(typeof mcSEAttachCover==='function')return mcSEAttachCover(x,c);return CoverVault.attach(x,c.data.coverUrl)}

  function progressText(s){return `Revisadas ${s.checked}/${s.total} · guardadas ${s.saved} · sin coincidencia segura ${s.skipped} · incidencias ${s.errors}${stopRequested?' · deteniendo…':''}`}
  function paint(s){lastProgress=progressText(s);const e=document.getElementById('mcAutoCoverProgress');if(e)e.textContent=lastProgress}
  function updateSelectedCount(){const e=document.getElementById('mcSelectedCount');if(e)e.textContent=`${selected.size.toLocaleString('es-ES')} seleccionadas`}

  window.coversView=async function(){return head('Portadas','Filtra por colección, selecciona las fichas que quieras y completa únicamente ese bloque.')+`<div class="notice oknotice"><b>Trabajo por colecciones</b><div class="small muted">Editorial → Serie/Cabecera → Volumen/Etapa → Año. Después selecciona la página o todas las fichas filtradas y completa solo ese bloque.</div></div><div class="panel"><div id="mcCoverControls"></div><div id="coversbody"></div></div>`};

  window.renderCovers=async function(){
    const all=(await allStore('comics')).slice().sort(mcSortRecord),filtered=filterCore(all),own=all.filter(x=>x.coverKey).length,external=all.filter(x=>!x.coverKey&&hasExternal(x)).length,missing=all.length-own;
    const pubs=values(rowsBefore(all,'publisher'),'publisher'),headers=values(rowsBefore(all,'catalogHeader'),'catalogHeader'),vols=values(rowsBefore(all,'volume'),'volume'),stages=values(rowsBefore(all,'stage'),'stage'),years=values(rowsBefore(all,'startYear'),'startYear');
    const pages=Math.max(1,Math.ceil(filtered.length/PER_PAGE));coverPage=Math.max(1,Math.min(coverPage,pages));const slice=filtered.slice((coverPage-1)*PER_PAGE,coverPage*PER_PAGE);lastFilteredIds=slice.filter(x=>!x.coverKey).map(x=>String(x.id));
    const controls=document.getElementById('mcCoverControls');if(!controls)return;
    controls.innerHTML=`<div class="cover-stats"><span class="cover-stat ok">${own.toLocaleString('es-ES')} propias/sincronizadas</span><span class="cover-stat">${external.toLocaleString('es-ES')} enlaces externos no verificados</span><span class="cover-stat miss">${missing.toLocaleString('es-ES')} sin portada</span></div>
    <div class="mc-cover-filter-dashboard mc-cover-filter-dashboard-v2">
      <label class="mc-cf mc-cf-search"><span>⌕ BUSCAR FICHA</span><input id="coverQ" ${running?'disabled':''} value="${escOpt(f.q)}" placeholder="Editorial, serie, número, ISBN…" oninput="AutoCover.setSearch(this.value)"></label>
      <label class="mc-cf mc-cf-pub"><span>▣ EDITORIAL</span>${selectHtml('publisher','Todas las editoriales',pubs,f.publisher)}</label>
      <label class="mc-cf mc-cf-series"><span>▤ CABECERA / SERIE</span>${selectHtml('catalogHeader','Todas las cabeceras',headers,f.catalogHeader)}</label>
      <label class="mc-cf mc-cf-volume"><span>▥ VOLUMEN</span>${selectHtml('volume','Todos los volúmenes',vols,f.volume)}</label>
      <label class="mc-cf mc-cf-stage"><span>◆ ETAPA</span>${selectHtml('stage','Todas las etapas',stages,f.stage)}</label>
      <label class="mc-cf mc-cf-year"><span>◷ AÑO DE INICIO</span>${selectHtml('startYear','Todos los años',years,f.startYear)}</label>
      <label class="mc-cf mc-cf-state"><span>● ESTADO</span><select ${running?'disabled':''} onchange="AutoCover.setStatus(this.value)"><option value="" ${!f.status?'selected':''}>Todos los estados</option><option value="In Collection" ${f.status==='In Collection'?'selected':''}>En colección</option><option value="On Wish List" ${f.status==='On Wish List'?'selected':''}>Wishlist</option><option value="__blank__" ${f.status==='__blank__'?'selected':''}>Sin estado</option></select></label>
      <div class="mc-cf-hint">Fichas sin imagen propia · ${filtered.length.toLocaleString('es-ES')} pendientes con estos filtros</div>
    </div>
    <div class="notice" style="margin:10px 0">La consulta de portadas es individual. En la edición comercial no se descargan ni se guardan automáticamente imágenes de terceros por lotes. Puedes consultar Open Library o subir una foto que puedas utilizar legítimamente.</div>`;

    document.getElementById('coversbody').innerHTML=`<div class="cover-manager-grid">${slice.map(x=>{const id=encId(x.id),checked=selected.has(String(x.id)),disabled=!!x.coverKey||running;return `<article class="cover-manager-card ${x.coverKey?'found':'missing'}" style="position:relative">${img({...x,coverUrl:''},'cover gallerycover')}<div><div class="record-kicker">${escOpt(x.publisher)} · ${escOpt([x.volume,x.stage,x.startYear].filter(Boolean).join(' · '))}</div><div class="record-title">${escOpt(x.catalogHeader||x.series)}</div><div class="record-sub">${x.issueNr!==''?'Nº '+escOpt(x.issueNr):''}${x.title?' · '+escOpt(x.title):''}</div><div class="isbn">ISBN: ${escOpt(x.isbn||'sin informar')}</div><div class="cover-actions">${!x.coverKey?`<button class="btn sm primary" ${running?'disabled':''} onclick="AutoCover.find('${id}')">Consultar portada</button>`:''}<label class="btn sm ${running?'disabled':''}">Subir imagen propia<input class="hidden" ${running?'disabled':''} type="file" accept="image/*" onchange="AutoCover.upload('${id}',this.files[0]);this.value='' "></label><button class="btn sm" ${running?'disabled':''} onclick="AutoCover.edit('${id}')">Ficha</button></div></div></article>`}).join('')||'<div class="empty">No hay fichas con estos filtros.</div>'}</div><div class="pager"><span>${filtered.length.toLocaleString('es-ES')} fichas · Página ${coverPage}/${pages}</span><span><button class="btn sm" ${running||coverPage<=1?'disabled':''} onclick="AutoCover.prev()">Anterior</button> <button class="btn sm" ${running||coverPage>=pages?'disabled':''} onclick="AutoCover.next()">Siguiente</button></span></div>`;
    CoverVault?.hydrate?.();updateSelectedCount();
  };

  async function runSelected(){toast('La descarga masiva de portadas está desactivada para la edición comercial. Selecciona una ficha para consultar Open Library.');}

  function resetAfterFilter(){clearSelected();coverPage=1;lastProgress=''}
  function setFilter(k,v){if(locked())return;resetAfterFilter();f[k]=v;const i=order.indexOf(k);if(i>=0)order.slice(i+1).forEach(z=>f[z]='');renderCovers()}
  function setSearch(v){if(locked())return;clearSelected();f.q=v;coverPage=1;clearTimeout(setSearch.t);setSearch.t=setTimeout(()=>renderCovers(),180)}
  function setStatus(v){if(locked())return;resetAfterFilter();f.status=v;renderCovers()}
  function setCoverState(){return;}
  async function selectPage(){if(locked())return;const add=lastFilteredIds.filter(id=>!selected.has(id));if(selected.size+add.length>MAX_SELECT)return toast(`La selección superaría ${MAX_SELECT} fichas. Completa primero el bloque actual.`);add.forEach(id=>selected.add(id));await renderCovers()}
  async function selectFiltered(){if(locked())return;const rows=filterCore(await allStore('comics')).filter(x=>!x.coverKey);if(!rows.length)return toast('No hay fichas pendientes con estos filtros');if(rows.length>MAX_SELECT)return toast(`El filtro devuelve ${rows.length.toLocaleString('es-ES')} fichas. Usa “Seleccionar página” o acota por serie/volumen/año hasta ${MAX_SELECT} o menos.`);rows.forEach(x=>selected.add(String(x.id)));await renderCovers()}
  function clearSelection(){if(locked())return;clearSelected();renderCovers()}
  function toggle(id,on){if(locked())return;id=decId(id);if(on&&selected.size>=MAX_SELECT){toast(`Máximo ${MAX_SELECT} fichas seleccionadas`);renderCovers();return}on?selected.add(id):selected.delete(id);updateSelectedCount()}
  function stop(){if(running){stopRequested=true;toast('Deteniendo al terminar la ficha actual')}}
  function prev(){if(locked())return;coverPage=Math.max(1,coverPage-1);renderCovers()}
  function next(){if(locked())return;coverPage++;renderCovers()}
  async function find(id){if(locked())return;return window.MCCommercialCovers?.open?.(id)}
  async function internalize(){toast('La copia de portadas externas no está habilitada en la edición comercial.')}
  async function upload(id,file){
    if(locked()||!file)return;
    const ok=confirm('Esta imagen se guardará en tu colección local. Comprueba que tienes derecho a utilizarla y que no vas a redistribuirla públicamente. ¿Continuar?');
    if(!ok)return;
    const comic=await getStore('comics',decId(id));if(!comic)return toast('Ficha no encontrada');
    busy(true,'Guardando imagen localmente…');
    try{
      await CoverVault.attachFile(comic,file,{sync:false});
      toast('Imagen guardada localmente. La copia a nube pública está desactivada.');
      await renderCovers();
    }catch(e){toast('No se pudo guardar: '+(e?.message||e))}finally{busy(false)}
  }
  function edit(id){if(locked())return;editComic(decId(id))}

  window.AutoCover={runSelected,stop,setFilter,setSearch,setStatus,setCoverState,selectPage,selectFiltered,clearSelection,toggle,prev,next,find,internalize,upload,edit};
})();
