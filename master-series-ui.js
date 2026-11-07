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
 '<div class="panel mc-master-series-panel"><div class="filters series-filters mc-master-series-filters">'+
 '<input id="mq" value="'+esc(state.q)+'" placeholder="Buscar colección…" aria-label="Buscar colección en Maestro">'+
 '<select id="mpub" aria-label="Editorial">'+option('','Todas las editoriales',state.publisher)+(idx.publishers||[]).map(p=>option(p.publisher,p.publisher,state.publisher)).join('')+'</select>'+
 '</div><div class="mc-master-advanced-wrap"><button type="button" class="btn sm mc-master-advanced-toggle" id="mc-master-advanced-toggle" aria-expanded="false">Más filtros <span aria-hidden="true">⌄</span></button><div id="mc-master-detail-filters" hidden></div></div><div id="masterbody">'+info()+'</div></div>';
};
renderMaster=async function(){
 const body=document.getElementById('masterbody');if(!body)return;
 const token=++state.serial;
 const pub=document.getElementById('mpub')?.value||'';
 state.publisher=pub;filters.publisher=pub;
 const q=normalize(document.getElementById('mq')?.value||'');state.q=q;filters.q=q;
 const idx=await mcSEMasterIndex();
 if(token!==state.serial)return;
 if(!pub){
   document.getElementById('mc-master-detail-filters').innerHTML='';
   const list=(idx.publishers||[]).filter(p=>!q||mcSENorm(p.publisher).includes(mcSENorm(q))).sort((a,b)=>(b.priority-a.priority)||b.issues-a.issues);
   const per=36,pages=Math.max(1,Math.ceil(list.length/per));state.page=Math.min(state.page,pages);
   const slice=list.slice((state.page-1)*per,state.page*per);
   body.innerHTML='<p class="mc-master-help">Selecciona una editorial para ver las colecciones en formato de fichas.</p><div class="mc-master-publishers">'+slice.map(p=>'<button type="button" class="mc-master-publisher" data-master-publisher="'+esc(p.publisher)+'"><strong>'+esc(p.publisher)+'</strong><small>'+p.series.toLocaleString('es-ES')+' series · '+p.issues.toLocaleString('es-ES')+' números</small></button>').join('')+'</div>'+pager(list.length,pages);
   bind();return;
 }
 body.innerHTML='<p class="muted">Cargando colecciones de '+esc(pub)+'…</p>';
 const rows=await mcMasterLoadPublisher(pub);
 if(token!==state.serial)return;
 const filtersBox=document.getElementById('mc-master-detail-filters');
 filtersBox.innerHTML=opts(rows,'catalogHeader','Todas las cabeceras',state.header)+opts(rows,'volume','Todos los volúmenes',state.volume)+opts(rows,'stage','Todas las etapas',state.stage)+opts(rows,'startYear','Todos los años',state.year);
 const toggle=document.getElementById('mc-master-advanced-toggle');if(toggle){toggle.onclick=()=>{const expanded=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(expanded));filtersBox.hidden=!expanded;toggle.innerHTML=expanded?'Menos filtros <span aria-hidden="true">⌃</span>':'Más filtros <span aria-hidden="true">⌄</span>'};}
 const checks=[['catalogHeader','header'],['volume','volume'],['stage','stage'],['startYear','year']];
 for(const [field,prop] of checks){if(state[prop]&&!rows.some(r=>normalize(r[field])===state[prop]))state[prop]='';filtersBox.querySelector('[data-master-filter="'+field+'"]').value=state[prop]}
 let filtered=rows.filter(r=>{
   if(q&&!mcSENorm([r.publisher,r.catalogHeader,r.series,r.title,r.isbn,r.issueNr].join(' ')).includes(mcSENorm(q)))return false;
   return checks.every(([field,prop])=>!state[prop]||normalize(r[field])===state[prop]);
 });
 const groups=new Map();
 for(const r of filtered){const key=mcMasterGroupKey(r);if(!groups.has(key))groups.set(key,{sample:r,cover:null,count:0});const g=groups.get(key);g.count++;if(!g.cover&&r.coverUrl)g.cover=r}
 const list=[...groups.entries()].sort((a,b)=>mcMasterGroupLabel(a[1].sample).localeCompare(mcMasterGroupLabel(b[1].sample),'es',{numeric:true}));
 const per=48,pages=Math.max(1,Math.ceil(list.length/per));state.page=Math.min(state.page,pages);
 const slice=list.slice((state.page-1)*per,state.page*per);
 body.innerHTML='<div class="mc-master-summary"><strong>'+esc(pub)+'</strong><span>'+list.length.toLocaleString('es-ES')+' colecciones · '+filtered.length.toLocaleString('es-ES')+' números</span></div>'+
 '<div class="series-grid visual mc-master-series-grid">'+slice.map(([key,g])=>{const r=g.sample;return '<article class="series-card visual mc-master-series-card" data-master-series="'+encodeURIComponent(key)+'" tabindex="0" role="button" aria-label="Abrir '+esc(mcMasterGroupLabel(r))+'"><div class="series-cover">'+img(g.cover||r,'cover seriescover')+'</div><div class="series-content"><div class="comic-kicker">'+esc(r.publisher)+'</div><div class="series-title">'+esc(r.catalogHeader||r.series||'Sin cabecera')+'</div><div class="master-meta">'+esc([r.volume&&'Vol. '+r.volume,r.stage,r.startYear].filter(Boolean).join(' · ')||'Edición sin identificar')+'</div><div class="series-stats">'+g.count.toLocaleString('es-ES')+' números en Maestro</div><div class="mc-master-open">Ver números</div></div></article>'}).join('')+'</div>'+pager(list.length,pages);
 bind();
};
function pager(total,pages){return '<div class="pager"><span>'+total.toLocaleString('es-ES')+' resultados · Página '+state.page+'/'+pages+'</span><span><button class="btn sm" data-master-page="-1" '+(state.page<=1?'disabled':'')+'>Anterior</button> <button class="btn sm" data-master-page="1" '+(state.page>=pages?'disabled':'')+'>Siguiente</button></span></div>'}
function bind(){
 const pub=document.getElementById('mpub');if(pub)pub.onchange=()=>{state.publisher=pub.value;state.header='';state.volume='';state.stage='';state.year='';state.page=1;renderMaster()};
 const q=document.getElementById('mq');if(q)q.oninput=()=>{state.q=q.value;state.page=1;renderMaster()};
 document.querySelectorAll('[data-master-filter]').forEach(el=>el.onchange=()=>{const map={catalogHeader:'header',volume:'volume',stage:'stage',startYear:'year'};state[map[el.dataset.masterFilter]]=el.value;state.page=1;renderMaster()});
 document.querySelectorAll('[data-master-publisher]').forEach(el=>el.onclick=()=>{state.publisher=el.dataset.masterPublisher;state.header='';state.volume='';state.stage='';state.year='';state.page=1;pub.value=state.publisher;renderMaster()});
 document.querySelectorAll('[data-master-page]').forEach(el=>el.onclick=()=>{state.page+=Number(el.dataset.masterPage);renderMaster()});
 document.querySelectorAll('[data-master-series]').forEach(el=>{const open=()=>openMasterCollection(el.dataset.masterSeries);el.onclick=open;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}}});
}
})();