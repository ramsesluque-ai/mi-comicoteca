'use strict';
/* v33: gestor de portadas por selección y filtros. Diseñado para catálogos grandes. */
(function(){
  const MAX_SELECT=500,MAX_RUN=250;
  const order=['publisher','catalogHeader','volume','stage','startYear'];
  const f={q:'',publisher:'',catalogHeader:'',volume:'',stage:'',startYear:'',status:'In Collection',coverState:'pending'};
  const selected=new Set();
  let coverPage=1,running=false,stopRequested=false,lastProgress='';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const code=v=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const issue=v=>String(v??'').trim();
  const val=(x,k)=>k==='catalogHeader'?String(x.catalogHeader||x.series||''):String(x[k]??'');
  const encId=id=>encodeURIComponent(String(id??''));
  const decId=id=>decodeURIComponent(String(id??''));
  const hasExternal=x=>/^https:\/\//i.test(String(x?.coverUrl||''))||/^data:image\//i.test(String(x?.coverUrl||''));

  function escOpt(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function byStatus(rows){if(!f.status)return rows;if(f.status==='__blank__')return rows.filter(x=>!x.status);return rows.filter(x=>x.status===f.status)}
  function byCover(rows){if(f.coverState==='pending')return rows.filter(x=>!x.coverKey);if(f.coverState==='missing')return rows.filter(x=>!x.coverKey&&!x.coverUrl);if(f.coverState==='external')return rows.filter(x=>!x.coverKey&&hasExternal(x));if(f.coverState==='stored')return rows.filter(x=>!!x.coverKey);return rows}
  function filterCore(rows,includeSearch=true){let a=byStatus(rows);for(const k of order)if(f[k])a=a.filter(x=>val(x,k)===String(f[k]));if(includeSearch&&f.q){const q=norm(f.q);a=a.filter(x=>norm([x.publisher,x.catalogHeader,x.series,x.volume,x.stage,x.startYear,x.title,x.issueNr,x.isbn].join(' ')).includes(q))}return byCover(a)}
  function rowsBefore(rows,field){let a=byStatus(rows);for(const k of order){if(k===field)break;if(f[k])a=a.filter(x=>val(x,k)===String(f[k]))}return a}
  function values(rows,field){return [...new Set(rows.map(x=>val(x,field)).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es',{numeric:true,sensitivity:'base'}))}
  function selectHtml(id,label,vals,current){return `<select id="${id}" onchange="AutoCover.setFilter('${id}',this.value)"><option value="">${label}</option>${vals.map(v=>`<option value="${escOpt(v)}" ${String(current)===String(v)?'selected':''}>${escOpt(v)}</option>`).join('')}</select>`}

  function safeCandidate(x,c){
    const d=c?.data||{};if(!d.coverUrl)return false;
    const xc=code(x.isbn),dc=code(d.isbn);if(xc&&dc&&xc===dc)return true;
    if(!issue(x.issueNr??x.issue)||!issue(d.issueNr)||!mcSEIssueExact(issue(x.issueNr??x.issue),issue(d.issueNr)))return false;
    if(x.publisher&&d.publisher&&!mcSEPubCompatible(x.publisher,d.publisher))return false;
    if((x.catalogHeader||x.series)&&d.series&&mcSESeriesScore(x.catalogHeader||x.series,d.series)<0.90)return false;
    if(x.startYear&&d.startYear&&String(x.startYear)!==String(d.startYear))return false;
    return Number(c.score||0)>=9000;
  }
  async function candidateFor(x){if(hasExternal(x))return{source:'asociada',data:{coverUrl:x.coverUrl,coverUrls:[x.coverUrl]}};const list=typeof mcSESearch==='function'?await mcSESearch(x):[];return(list||[]).find(c=>safeCandidate(x,c))||null}
  async function attach(x,c){if(c.source==='asociada')return CoverVault.attach(x,c.data.coverUrl);if(typeof mcSEAttachCover==='function')return mcSEAttachCover(x,c);return CoverVault.attach(x,c.data.coverUrl)}

  function progressText(s){return `Revisadas ${s.checked}/${s.total} · guardadas ${s.saved} · sin coincidencia segura ${s.skipped} · incidencias ${s.errors}${stopRequested?' · deteniendo…':''}`}
  function paint(s){lastProgress=progressText(s);const e=document.getElementById('mcAutoCoverProgress');if(e)e.textContent=lastProgress}
  function updateSelectedCount(){const e=document.getElementById('mcSelectedCount');if(e)e.textContent=`${selected.size.toLocaleString('es-ES')} seleccionadas`}

  window.coversView=async function(){return head('Portadas','Filtra por colección, selecciona las fichas que quieras y completa únicamente ese bloque.')+`<div class="notice oknotice"><b>Trabajo por colecciones</b><div class="small muted">Recomendado para una comicoteca grande: Editorial → Serie/Cabecera → Volumen/Etapa → Año. Después selecciona las fichas filtradas y completa solo esas portadas.</div></div><div class="panel"><div id="mcCoverControls"></div><div id="coversbody"></div></div>`};

  window.renderCovers=async function(){
    const all=(await allStore('comics')).slice().sort(mcSortRecord),filtered=filterCore(all),own=all.filter(x=>x.coverKey).length,external=all.filter(x=>!x.coverKey&&hasExternal(x)).length,missing=all.length-own-external;
    const pubs=values(rowsBefore(all,'publisher'),'publisher'),headers=values(rowsBefore(all,'catalogHeader'),'catalogHeader'),vols=values(rowsBefore(all,'volume'),'volume'),stages=values(rowsBefore(all,'stage'),'stage'),years=values(rowsBefore(all,'startYear'),'startYear');
    const controls=document.getElementById('mcCoverControls');if(!controls)return;
    controls.innerHTML=`<div class="cover-stats"><span class="cover-stat ok">${own.toLocaleString('es-ES')} propias/sincronizadas</span><span class="cover-stat">${external.toLocaleString('es-ES')} enlazadas externas</span><span class="cover-stat miss">${missing.toLocaleString('es-ES')} sin portada</span></div>
    <div class="filters covers-filters" style="padding:12px 15px">
      <input id="coverQ" value="${escOpt(f.q)}" placeholder="Buscar ficha…" oninput="AutoCover.setSearch(this.value)">
      ${selectHtml('publisher','Todas las editoriales',pubs,f.publisher)}
      ${selectHtml('catalogHeader','Todas las series/cabeceras',headers,f.catalogHeader)}
      ${selectHtml('volume','Todos los volúmenes',vols,f.volume)}
      ${selectHtml('stage','Todas las etapas',stages,f.stage)}
      ${selectHtml('startYear','Todos los años',years,f.startYear)}
      <select onchange="AutoCover.setStatus(this.value)"><option value="" ${!f.status?'selected':''}>Todos los estados</option><option value="In Collection" ${f.status==='In Collection'?'selected':''}>En colección</option><option value="On Wish List" ${f.status==='On Wish List'?'selected':''}>Wishlist</option><option value="__blank__" ${f.status==='__blank__'?'selected':''}>Sin estado</option></select>
      <select onchange="AutoCover.setCoverState(this.value)"><option value="pending" ${f.coverState==='pending'?'selected':''}>Pendientes: sin portada propia</option><option value="missing" ${f.coverState==='missing'?'selected':''}>Sin portada</option><option value="external" ${f.coverState==='external'?'selected':''}>Enlazadas externas</option><option value="stored" ${f.coverState==='stored'?'selected':''}>Propias/sincronizadas</option><option value="all" ${f.coverState==='all'?'selected':''}>Todas</option></select>
    </div>
    <div class="toolbar" style="padding:12px 15px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn" onclick="AutoCover.selectFiltered()">Seleccionar filtradas (${filtered.filter(x=>!x.coverKey).length.toLocaleString('es-ES')})</button>
      <button class="btn" onclick="AutoCover.clearSelection()">Deseleccionar</button>
      <span id="mcSelectedCount" class="small muted">${selected.size.toLocaleString('es-ES')} seleccionadas</span>
      <button class="btn primary" ${running?'disabled':''} onclick="AutoCover.runSelected()">Completar portadas seleccionadas</button>
      ${running?'<button class="btn" onclick="AutoCover.stop()">Detener</button>':''}
      <span id="mcAutoCoverProgress" class="small muted">${escOpt(lastProgress)}</span>
    </div>`;
    const per=60,pages=Math.max(1,Math.ceil(filtered.length/per));coverPage=Math.min(coverPage,pages);const slice=filtered.slice((coverPage-1)*per,coverPage*per);
    document.getElementById('coversbody').innerHTML=`<div class="cover-manager-grid">${slice.map(x=>{const id=encId(x.id),checked=selected.has(String(x.id)),disabled=!!x.coverKey;return `<article class="cover-manager-card ${x.coverKey?'found':'missing'}" style="position:relative"><label style="position:absolute;top:8px;left:8px;z-index:3;background:rgba(3,11,22,.86);padding:5px 7px;border-radius:8px"><input type="checkbox" ${checked?'checked':''} ${disabled?'disabled':''} onchange="AutoCover.toggle('${id}',this.checked)"></label>${img(x,'cover gallerycover')}<div><div class="record-kicker">${escOpt(x.publisher)} · ${escOpt([x.volume,x.stage,x.startYear].filter(Boolean).join(' · '))}</div><div class="record-title">${escOpt(x.catalogHeader||x.series)}</div><div class="record-sub">${x.issueNr!==''?'Nº '+escOpt(x.issueNr):''}${x.title?' · '+escOpt(x.title):''}</div><div class="isbn">ISBN: ${escOpt(x.isbn||'sin informar')}</div><div class="cover-actions">${!x.coverKey?`<button class="btn sm primary" onclick="AutoCover.find('${id}')">Buscar portada</button>`:''}${!x.coverKey&&x.coverUrl?`<button class="btn sm" onclick="AutoCover.internalize('${id}')">Guardar esta portada</button>`:''}<label class="btn sm">Subir imagen<input class="hidden" type="file" accept="image/*" onchange="AutoCover.upload('${id}',this.files[0]);this.value='' "></label><button class="btn sm" onclick="AutoCover.edit('${id}')">Ficha</button></div></div></article>`}).join('')||'<div class="empty">No hay fichas con estos filtros.</div>'}</div><div class="pager"><span>${filtered.length.toLocaleString('es-ES')} fichas · Página ${coverPage}/${pages}</span><span><button class="btn sm" ${coverPage<=1?'disabled':''} onclick="AutoCover.prev()">Anterior</button> <button class="btn sm" ${coverPage>=pages?'disabled':''} onclick="AutoCover.next()">Siguiente</button></span></div>`;
    CoverVault?.hydrate?.();updateSelectedCount();
  };

  async function runSelected(){
    if(running)return toast('Ya hay un proceso de portadas en marcha');
    if(!selected.size)return toast('Selecciona primero las fichas que quieras completar');
    if(!window.CoverVault?.hasCredentials?.()){toast('Carga primero la clave y la credencial desde Sincronizar');window.CloudSync?.show?.();return}
    const all=await allStore('comics'),map=new Map(all.map(x=>[String(x.id),x])),targets=[...selected].map(id=>map.get(String(id))).filter(x=>x&&!x.coverKey);
    if(!targets.length){selected.clear();await renderCovers();return toast('Las fichas seleccionadas ya tienen portada propia')}
    const batch=targets.slice(0,MAX_RUN),s={checked:0,total:batch.length,saved:0,skipped:0,errors:0};running=true;stopRequested=false;lastProgress='';await renderCovers();paint(s);
    try{
      for(const x of batch){
        if(stopRequested)break;
        try{const c=await candidateFor(x);if(!c)s.skipped++;else{await attach(x,c);s.saved++;await sleep(1100)}}catch(e){console.warn('AutoCover',x.id,e);s.errors++}
        selected.delete(String(x.id));s.checked++;paint(s);if(!stopRequested)await sleep(120);
      }
      window.CloudSync?.schedule?.();
      const remain=selected.size;lastProgress=`${progressText(s)}${remain?` · quedan ${remain.toLocaleString('es-ES')} seleccionadas`:''}`;
      toast(stopRequested?'Proceso detenido':`Lote terminado: ${s.saved} portadas guardadas`);
    }finally{running=false;stopRequested=false;await renderCovers()}
  }

  function setFilter(k,v){f[k]=v;const i=order.indexOf(k);if(i>=0)order.slice(i+1).forEach(z=>f[z]='');coverPage=1;renderCovers()}
  function setSearch(v){f.q=v;coverPage=1;clearTimeout(setSearch.t);setSearch.t=setTimeout(()=>renderCovers(),180)}
  function setStatus(v){f.status=v;coverPage=1;renderCovers()}
  function setCoverState(v){f.coverState=v;coverPage=1;renderCovers()}
  async function selectFiltered(){const rows=filterCore(await allStore('comics')).filter(x=>!x.coverKey);if(!rows.length)return toast('No hay fichas pendientes con estos filtros');if(rows.length>MAX_SELECT)return toast(`El filtro devuelve ${rows.length.toLocaleString('es-ES')} fichas. Acota por serie/volumen/año hasta ${MAX_SELECT} o menos para trabajar con seguridad.`);rows.forEach(x=>selected.add(String(x.id)));await renderCovers()}
  function clearSelection(){selected.clear();renderCovers()}
  function toggle(id,on){id=decId(id);on?selected.add(id):selected.delete(id);updateSelectedCount()}
  function stop(){if(running){stopRequested=true;toast('Deteniendo al terminar la ficha actual')}}
  function prev(){coverPage=Math.max(1,coverPage-1);renderCovers()}
  function next(){coverPage++;renderCovers()}
  async function find(id){return mcFindCover(decId(id))}
  async function internalize(id){await mcInternalizeOne(decId(id));await renderCovers()}
  async function upload(id,file){if(!file)return;await mcUploadCover(decId(id),file);await renderCovers()}
  function edit(id){editComic(decId(id))}

  window.AutoCover={runSelected,stop,setFilter,setSearch,setStatus,setCoverState,selectFiltered,clearSelection,toggle,prev,next,find,internalize,upload,edit};
})();
