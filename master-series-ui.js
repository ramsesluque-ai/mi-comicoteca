'use strict';
/* Master series browser: same series-card layout as personal Collections. Publisher chunks load on demand. */
(function(){
const state={publisher:'',q:'',header:'',volume:'',stage:'',year:'',page:1,serial:0};
const normalize=v=>String(v??'').trim();
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
const unique=(rows,key)=>[...new Set(rows.map(x=>normalize(x[key])).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
const opts=(rows,key,label,value)=>'<select data-master-filter="'+key+'" aria-label="'+esc(label)+'">'+option('',label,value)+unique(rows,key).map(v=>option(v,v,value)).join('')+'</select>';
const info=()=>'<div class="mc-master-info">Selecciona una editorial para explorar sus colecciones. Los datos se cargan por editorial para mantener el catálogo ágil.</div>';
masterView=async function(){
 const idx=await mcSEMasterIndex();
 state.publisher=filters.publisher||state.publisher||'';
 state.q=filters.q||state.q||'';
 return head('Maestro',idx.totalIssues.toLocaleString('es-ES')+' ejemplares · '+idx.totalSeries.toLocaleString('es-ES')+' series · '+idx.totalPublishers.toLocaleString('es-ES')+' editoriales')+
 '<div class="panel mc-master-series-panel"><div class="mc-master-filter-dashboard">'+
 '<label class="mc-mf mc-mf-search"><span>⌕ BUSCAR COLECCIÓN</span><input id="mq" value="'+esc(state.q)+'" placeholder="Editorial, serie, etapa…" aria-label="Buscar colección"></label>'+
 '<label class="mc-mf mc-mf-publisher"><span>▣ EDITORIAL</span><select id="mpub" aria-label="Editorial">'+option('','Todas las editoriales',state.publisher)+(idx.publishers||[]).map(p=>option(p.publisher,p.publisher,state.publisher)).join('')+'</select></label>'+
 '<label class="mc-mf mc-mf-header"><span>▤ CABECERA / SERIE</span><select data-master-filter="catalogHeader" aria-label="Cabecera">'+option('','Todas las cabeceras',state.header)+'</select></label>'+
 '<label class="mc-mf mc-mf-volume"><span>▥ VOLUMEN</span><select data-master-filter="volume" aria-label="Volumen">'+option('','Todos los volúmenes',state.volume)+'</select></label>'+
 '<label class="mc-mf mc-mf-stage"><span>◆ ETAPA</span><select data-master-filter="stage" aria-label="Etapa">'+option('','Todas las etapas',state.stage)+'</select></label>'+
 '<label class="mc-mf mc-mf-year"><span>◷ AÑO DE INICIO</span><select data-master-filter="startYear" aria-label="Año de inicio">'+option('','Todos los años',state.year)+'</select></label>'+
 '<div class="mc-mf-hint" id="mc-master-filter-hint">Sin filtros activos · se muestran todos los registros</div>'+
 '</div><div id="masterbody">'+info()+'</div></div>';
};
renderMaster=async function(){
 const body=document.getElementById('masterbody');if(!body)return;
 const token=++state.serial;
 const pub=document.getElementById('mpub')?.value||'';
 state.publisher=pub;filters.publisher=pub;
 const q=normalize(document.getElementById('mq')?.value||'');state.q=q;filters.q=q;
 const idx=await mcSEMasterIndex();
 if(token!==state.serial)return;
 const hint=document.getElementById('mc-master-filter-hint');
 if(hint)hint.textContent=[q&&'Búsqueda activa',pub&&'Editorial: '+pub,state.header&&'Cabecera: '+state.header,state.volume&&'Volumen: '+state.volume,state.stage&&'Etapa: '+state.stage,state.year&&'Año: '+state.year].filter(Boolean).join(' · ')||'Sin filtros activos · se muestran todos los registros';

 if(!pub){
   document.querySelectorAll('[data-master-filter]').forEach(el=>{el.innerHTML=option('',{catalogHeader:'Todas las cabeceras',volume:'Todos los volúmenes',stage:'Todas las etapas',startYear:'Todos los años'}[el.dataset.masterFilter],'');el.disabled=true;});
   const list=(idx.publishers||[]).filter(p=>!q||mcSENorm(p.publisher).includes(mcSENorm(q))).sort((a,b)=>(b.priority-a.priority)||b.issues-a.issues);
   const per=36,pages=Math.max(1,Math.ceil(list.length/per));state.page=Math.min(state.page,pages);
   const slice=list.slice((state.page-1)*per,state.page*per);
   body.innerHTML='<p class="mc-master-help">Selecciona una editorial para ver las colecciones en formato de fichas.</p><div class="mc-master-publishers">'+slice.map(p=>'<button type="button" class="mc-master-publisher" data-master-publisher="'+esc(p.publisher)+'"><strong>'+esc(p.publisher)+'</strong><small>'+p.series.toLocaleString('es-ES')+' series · '+p.issues.toLocaleString('es-ES')+' números</small></button>').join('')+'</div>'+pager(list.length,pages);
   bind();return;
 }
 body.innerHTML='<p class="muted">Cargando colecciones de '+esc(pub)+'…</p>';
 const rows=await mcMasterLoadPublisher(pub);
 if(token!==state.serial)return;
 for(const [field,label,value] of [['catalogHeader','Todas las cabeceras',state.header],['volume','Todos los volúmenes',state.volume],['stage','Todas las etapas',state.stage],['startYear','Todos los años',state.year]]){
   const el=document.querySelector('[data-master-filter="'+field+'"]');
   if(el){el.innerHTML=option('',label,value)+unique(rows,field).map(v=>option(v,v,value)).join('');el.disabled=false;}
 }
 const checks=[['catalogHeader','header'],['volume','volume'],['stage','stage'],['startYear','year']];
 for(const [field,prop] of checks){if(state[prop]&&!rows.some(r=>normalize(r[field])===state[prop]))state[prop]='';document.querySelector('[data-master-filter="'+field+'"]').value=state[prop]}
 let filtered=rows.filter(r=>{
   if(q&&!mcSENorm([r.publisher,r.catalogHeader,r.series,r.title,r.isbn,r.issueNr].join(' ')).includes(mcSENorm(q)))return false;
   return checks.every(([field,prop])=>!state[prop]||normalize(r[field])===state[prop]);
 });

 const groups=new Map();
 for(const r of filtered){const key=mcMasterGroupKey(r);if(!groups.has(key))groups.set(key,{sample:r,cover:null,count:0});const g=groups.get(key);g.count++;if(!g.cover&&r.coverUrl)g.cover=r}
 // Personal-only series are shown as reconciliation candidates, never counted as verified Maestro records.
 const personal=await allStore('comics');
 if(token!==state.serial)return;
 const existingNames=new Set(rows.map(r=>mcSENorm(r.catalogHeader||r.series)));
 const missing=new Map();
 for(const r of personal){
   if(mcSENorm(r.publisher)!==mcSENorm(pub))continue;
   const name=String(r.catalogHeader||r.series||'').trim();
   if(!name||existingNames.has(mcSENorm(name)))continue;
   if(q&&!mcSENorm([r.publisher,name,r.title,r.isbn,r.issueNr].join(' ')).includes(mcSENorm(q)))continue;
   if(state.header||state.volume||state.stage||state.year)continue;
   const key=ckey(r);
   if(!missing.has(key))missing.set(key,{sample:r,count:0,cover:null});
   const g=missing.get(key);g.count++;if(!g.cover&&(r.coverUrl||r.coverData||r.coverBlob))g.cover=r;
 }
 const personalCards=[...missing.entries()].sort((a,b)=>String(a[1].sample.catalogHeader||a[1].sample.series).localeCompare(String(b[1].sample.catalogHeader||b[1].sample.series),'es',{numeric:true}));
 MCMasterUI.visibleGroups=new Map();
 for(const [key,g] of groups){MCMasterUI.visibleGroups.set(key,{publisher:pub,rows:filtered.filter(x=>mcMasterGroupKey(x)===key)});}
 const list=[...groups.entries()].sort((a,b)=>mcMasterGroupLabel(a[1].sample).localeCompare(mcMasterGroupLabel(b[1].sample),'es',{numeric:true}));
 const per=48,pages=Math.max(1,Math.ceil(list.length/per));state.page=Math.min(state.page,pages);
 const slice=list.slice((state.page-1)*per,state.page*per);
 body.innerHTML='<div class="mc-master-summary"><strong>'+esc(pub)+'</strong><span>'+list.length.toLocaleString('es-ES')+' colecciones · '+filtered.length.toLocaleString('es-ES')+' números</span></div>'+
 '<div class="series-grid visual mc-master-series-grid">'+slice.map(([key,g])=>{const r=g.sample;return '<article class="series-card visual mc-master-series-card" data-master-series="'+encodeURIComponent(key)+'" tabindex="0" role="button" aria-label="Abrir '+esc(mcMasterGroupLabel(r))+'"><div class="series-cover">'+img(g.cover||r,'cover seriescover')+'</div><div class="series-content"><div class="comic-kicker">'+esc(r.publisher)+'</div><div class="series-title">'+esc(r.catalogHeader||r.series||'Sin cabecera')+'</div><div class="master-meta">'+esc([r.volume&&'Vol. '+r.volume,r.stage,r.startYear].filter(Boolean).join(' · ')||'Edición sin identificar')+'</div><div class="series-stats">'+g.count.toLocaleString('es-ES')+' números en Maestro</div><div class="mc-master-open">Ver números</div></div></article>'}).join('')+'</div>'+pager(list.length,pages);
 if(personalCards.length){
   const section=document.createElement('section');
   section.className='mc-master-personal-only';
   section.innerHTML='<h3>Series de tu catálogo pendientes de incorporar al Maestro</h3><p>Estos registros proceden de tu colección personal; todavía no se han verificado como fichas del Maestro.</p><div class="series-grid visual mc-master-series-grid">'+personalCards.map(([key,g])=>{const r=g.sample;return '<article class="series-card visual mc-master-series-card" data-master-personal="'+encodeURIComponent(key)+'" tabindex="0" role="button"><div class="series-cover">'+img(g.cover||r,'cover seriescover')+'</div><div class="series-content"><div class="comic-kicker">'+esc(r.publisher)+' · Catálogo personal</div><div class="series-title">'+esc(r.catalogHeader||r.series)+'</div><div class="master-meta">'+esc([r.volume&&'Vol. '+r.volume,r.stage,r.startYear].filter(Boolean).join(' · ')||'Edición por verificar')+'</div><div class="series-stats">'+g.count+' números personales</div><div class="mc-master-open">Abrir colección</div></div></article>'}).join('')+'</div>';
   body.appendChild(section);
 }
 bind();
};
function pager(total,pages){return '<div class="pager"><span>'+total.toLocaleString('es-ES')+' resultados · Página '+state.page+'/'+pages+'</span><span><button class="btn sm" data-master-page="-1" '+(state.page<=1?'disabled':'')+'>Anterior</button> <button class="btn sm" data-master-page="1" '+(state.page>=pages?'disabled':'')+'>Siguiente</button></span></div>'}
function bind(){
 const pub=document.getElementById('mpub');if(pub)pub.onchange=()=>{state.publisher=pub.value;state.header='';state.volume='';state.stage='';state.year='';state.page=1;renderMaster()};
 const q=document.getElementById('mq');if(q)q.oninput=()=>{state.q=q.value;state.page=1;renderMaster()};
 document.querySelectorAll('[data-master-filter]').forEach(el=>el.onchange=()=>{const map={catalogHeader:'header',volume:'volume',stage:'stage',startYear:'year'};state[map[el.dataset.masterFilter]]=el.value;state.page=1;renderMaster()});
 document.querySelectorAll('[data-master-publisher]').forEach(el=>el.onclick=()=>{state.publisher=el.dataset.masterPublisher;state.header='';state.volume='';state.stage='';state.year='';state.page=1;pub.value=state.publisher;renderMaster()});
 document.querySelectorAll('[data-master-page]').forEach(el=>el.onclick=()=>{state.page+=Number(el.dataset.masterPage);renderMaster()});
 document.querySelectorAll('[data-master-personal]').forEach(el=>{const open=()=>openSeries(el.dataset.masterPersonal);el.onclick=open;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}}});
 document.querySelectorAll('[data-master-series]').forEach(el=>{const open=()=>openMasterCollection(el.dataset.masterSeries);el.onclick=open;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}}});
}
})();