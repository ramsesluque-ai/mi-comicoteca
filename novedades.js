'use strict';
/* MI COMICTECA: novedades editoriales, ventana móvil de dos meses.
   Datos editoriales curados con fuente; las portadas no se copian. */
(function(){
 const MONTHS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
 let records=[],publisherDirectory=[],loaded=false,loading=false,lastUpdate='',error='';
 const ui={publisher:'',month:'',q:''};
 // Shared state for lazy cover resolution. Without these declarations the
 // Novedades renderer throws ReferenceError before any cards can appear.
 const coverCache=new Map();
 const coverInFlight=new Set();
 const coverFailedAt=new Map();
 const COVER_RETRY_MS=5*60*1000;
 let coverObserver=null;
 const sanitize=x=>typeof esc==='function'?esc(x):String(x??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
 const monthKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
 function allowedMonths(){const now=new Date(),previous=new Date(now.getFullYear(),now.getMonth()-1,1);return [monthKey(now),monthKey(previous)]}
 function monthLabel(key){const [y,m]=String(key).split('-');return MONTHS[Number(m)-1]+' de '+y}
 function dateLabel(r){if(r.publicationDate&&/^\d{4}-\d{2}-\d{2}$/.test(r.publicationDate)){const [y,m,d]=r.publicationDate.split('-');return d+' de '+MONTHS[Number(m)-1]+' de '+y}return monthLabel(r.releaseMonth)+' · día sin confirmar'}
 function urlSafe(u){try{const x=new URL(String(u));return x.protocol==='https:'?x.href:''}catch{return ''}}
 function shortDate(iso){return /^\d{4}-\d{2}-\d{2}$/.test(iso||'')?iso.slice(8)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4):''}
 function valueText(v){return v===null||v===undefined?'':String(v)}
 const classify=(r)=>r.publicationDate&&r.publicationDate>new Date().toISOString().slice(0,10)?'Próximamente':r.publicationDate?'Publicado':'Anunciado';
 async function load(){
   if(loading)return;
   loading=true;error='';
   try{
     const sources=[new URL('novedades-editoriales.json?v=20261111-isbn',document.currentScript?.src||location.href).href, 'https://raw.githubusercontent.com/ramsesluque-ai/mi-comicoteca/commercial-published/novedades-editoriales.json'];
     let body=null,lastFailure='';
     for(const source of sources){try{const response=await fetch(source,{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const candidate=await response.json();if(!Array.isArray(candidate.items)||!Array.isArray(candidate.publishers))throw new Error('Formato no válido');body=candidate;break}catch(e){lastFailure=e.message||String(e)}}
     if(!body)throw new Error('No se pudo obtener el catálogo de novedades: '+lastFailure);
     if(!Array.isArray(body.items)||!Array.isArray(body.publishers))throw new Error('Formato de novedades no válido');
     const months=allowedMonths();
     publisherDirectory=body.publishers.filter(x=>x&&x.publisher&&urlSafe(x.site));
     records=body.items.filter(x=>x&&x.id&&x.publisher&&x.title&&months.includes(x.releaseMonth)&&urlSafe(x.sourceUrl));
     const seen=new Set();records=records.filter(x=>{const key=[x.publisher,x.title,x.issueNr,x.releaseMonth].join('|').toLowerCase();if(seen.has(key))return false;seen.add(key);return true});
     records.sort((a,b)=>b.releaseMonth.localeCompare(a.releaseMonth)||(b.publicationDate||'').localeCompare(a.publicationDate||'')||a.publisher.localeCompare(b.publisher,'es'));
     loaded=true;lastUpdate=String(body.updatedAt||'');
   }catch(e){loaded=false;records=[];error=e.message||String(e)}
   finally{loading=false}
 }
 function authorizedCover(r){
   return urlSafe(r.coverUrl)||urlSafe(coverCache.get(r.id)||'');
 }
 function card(r){
   const href=urlSafe(r.sourceUrl),cover=authorizedCover(r),status=classify(r),issue=r.issueNr?(' · Nº '+sanitize(r.issueNr)):'',price=Number(r.price)>0?Number(r.price).toLocaleString('es-ES',{style:'currency',currency:'EUR'}):'';
   const details=[r.authors&&'Autores: '+r.authors,r.format&&'Formato: '+r.format,r.pages&&r.pages+' páginas',price&&'PVP: '+price].filter(Boolean);
   return '<article class="mc-novedad">'+
     (cover?'<div class="mc-novedad-cover mc-novedad-cover-image"><img loading="lazy" referrerpolicy="no-referrer" src="'+sanitize(cover)+'" alt="Portada de '+sanitize(r.title)+'" onerror="this.parentNode.classList.add(\'mc-cover-missing\');this.remove()"></div>':'<div class="mc-novedad-cover mc-novedad-pending" data-novedad-cover="'+sanitize(r.id)+'"><span aria-hidden="true">▤</span><small>Buscando portada oficial…</small></div>')+
     '<div class="mc-novedad-content">'+
       '<div class="mc-novedad-top"><span class="mc-novedad-publisher">'+sanitize(r.publisher)+'</span><span class="mc-novedad-state">'+sanitize(status)+'</span></div>'+
       '<h3>'+sanitize(r.title)+issue+'</h3><p class="mc-novedad-date">◷ '+sanitize(dateLabel(r))+'</p>'+
       (details.length?'<p class="mc-novedad-details">'+details.map(sanitize).join(' · ')+'</p>':'')+
       '<div class="mc-novedad-actions"><button type="button" class="btn sm" onclick="mcNovedadesDraft(\''+sanitize(r.id)+'\',\'In Collection\')">+ A colección</button>'+
       '<button type="button" class="btn sm" onclick="mcNovedadesDraft(\''+sanitize(r.id)+'\',\'On Wish List\')">♡ Wishlist</button>'+
       '<a class="btn sm mc-novedad-source" target="_blank" rel="noopener noreferrer" href="'+sanitize(href)+'">Ver ficha oficial ↗</a></div>'+
       '<div class="mc-novedad-info">La ficha se prepara sin guardarse. Confirma edición y número antes de añadirla.</div>'+
     '</div></article>';
 }
 function paint(){
   const area=document.getElementById('mcNovedadesArea');if(!area)return;
   const q=(ui.q||'').toLocaleLowerCase('es');
   const list=records.filter(r=>(!ui.publisher||r.publisher===ui.publisher)&&(!ui.month||r.releaseMonth===ui.month)&&(!q||[r.publisher,r.title,r.issueNr,r.authors].join(' ').toLocaleLowerCase('es').includes(q)));
   const count=document.getElementById('mcNovedadesCount');if(count)count.textContent=list.length+' novedades verificadas';
   if(coverObserver){coverObserver.disconnect();coverObserver=null}
   area.innerHTML=list.length?'<div class="mc-novedades-grid">'+list.map(card).join('')+'</div>':
     '<div class="card mc-novedad-empty">No hay novedades verificadas para los filtros seleccionados. Puedes consultar las editoriales desde sus enlaces oficiales.</div>';
   activateCoverLookup();
 }
 function mcNovedadesImageLoads(url){return new Promise(resolve=>{
 if(!url)return resolve(false);
 const img=new Image();let done=false;
 const finish=ok=>{if(done)return;done=true;clearTimeout(timer);img.onload=null;img.onerror=null;resolve(ok)};
 const timer=setTimeout(()=>finish(false),6500);
 img.onload=()=>finish(img.naturalWidth>=100&&img.naturalHeight>=100);
 img.onerror=()=>finish(false);
 img.referrerPolicy='no-referrer';img.src=url;
})}
async function lookupCover(r){
   if(coverInFlight.has(r.id))return;
   coverInFlight.add(r.id);
   try{
     let image='';
     const cfg=window.MI_COMICOTECA_CLOUD||{};
     if(cfg.url&&r.sourceUrl){
       const resp=await fetch(cfg.url+'/functions/v1/novedades-cover',{method:'POST',headers:{'Content-Type':'application/json',...(cfg.publishableKey?{apikey:cfg.publishableKey}:{})},body:JSON.stringify({title:r.title,isbn:r.isbn||'',sourceUrl:r.sourceUrl})});
       if(resp.ok){const result=await resp.json();image=urlSafe(result.coverUrl)}
     }
     if(!image&&r.isbn){
       const code=String(r.isbn).replace(/[^0-9X]/gi,'');
       try{const response=await fetch('https://openlibrary.org/api/books?bibkeys=ISBN:'+encodeURIComponent(code)+'&format=json&jscmd=data');if(response.ok){const data=await response.json();image=urlSafe(data['ISBN:'+code]?.cover?.medium||data['ISBN:'+code]?.cover?.large)}}catch{}
     }
     if(image&&!await mcNovedadesImageLoads(image))image='';
     coverCache.set(r.id,image||'');
     if(image)coverFailedAt.delete(r.id);else coverFailedAt.set(r.id,Date.now());
     const slot=document.querySelector('[data-novedad-cover="'+r.id+'"]');
     if(slot){
       if(image){slot.classList.add('mc-novedad-cover-image');slot.innerHTML='<img loading="lazy" referrerpolicy="no-referrer" src="'+sanitize(image)+'" alt="Portada de '+sanitize(r.title)+'" onerror="this.closest(\'.mc-novedad-cover\').innerHTML=\'<small>Portada no disponible</small>\'">'}
       else{slot.innerHTML='<span aria-hidden="true">▤</span><small>Portada no disponible · <a target="_blank" rel="noopener noreferrer" href="'+sanitize(urlSafe(r.sourceUrl))+'">Ver editorial ↗</a></small>'}
     }
   }catch(e){
     console.warn('Portada de novedad no disponible',r.id,e);
     coverCache.set(r.id,'');
     coverFailedAt.set(r.id,Date.now());
     const slot=document.querySelector('[data-novedad-cover="'+r.id+'"]');
     if(slot)slot.innerHTML='<span aria-hidden="true">▤</span><small>Portada no disponible · <a target="_blank" rel="noopener noreferrer" href="'+sanitize(urlSafe(r.sourceUrl))+'">Ver editorial ↗</a></small>';
   }
   finally{coverInFlight.delete(r.id)}
 }
 function activateCoverLookup(){
   const nodes=[...document.querySelectorAll('[data-novedad-cover]')];
   if(!nodes.length)return;
   const trigger=node=>{const r=records.find(x=>x.id===node.dataset.novedadCover);if(r&&(!coverCache.has(r.id)||(!coverCache.get(r.id)&&Date.now()-(coverFailedAt.get(r.id)||0)>=COVER_RETRY_MS)))void lookupCover(r)};
   if(typeof IntersectionObserver==='undefined'){nodes.slice(0,12).forEach(trigger);return}
   coverObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){coverObserver?.unobserve(entry.target);trigger(entry.target)}}},{rootMargin:'240px'});
   nodes.forEach(node=>{const id=node.dataset.novedadCover;if(coverCache.has(id)&&!coverCache.get(id)&&Date.now()-(coverFailedAt.get(id)||0)<COVER_RETRY_MS){const r=records.find(x=>x.id===id);node.innerHTML='<span aria-hidden="true">▤</span><small>Portada no disponible · <a target="_blank" rel="noopener noreferrer" href="'+sanitize(urlSafe(r?.sourceUrl))+'">Ver editorial ↗</a></small>'}else coverObserver.observe(node)});
 }
 async function view(){
   if(!loaded)await load();
   const months=allowedMonths();
   const options=publisherDirectory.map(p=>'<option value="'+sanitize(p.publisher)+'" '+(p.publisher===ui.publisher?'selected':'')+'>'+sanitize(p.publisher)+'</option>').join('');
   const monthOpts=months.map(m=>'<option value="'+sanitize(m)+'" '+(ui.month===m?'selected':'')+'>'+sanitize(monthLabel(m))+'</option>').join('');
   const dirs=publisherDirectory.map(p=>'<a href="'+sanitize(urlSafe(p.site))+'" target="_blank" rel="noopener noreferrer">'+sanitize(p.publisher)+'</a>').join('');
   return '<div class="top"><div><h1>Novedades</h1><div class="sub">Novedades editoriales de '+sanitize(monthLabel(months[1]))+' y '+sanitize(monthLabel(months[0]))+'. La ventana avanza automáticamente cada mes.</div></div></div>'+
   '<div class="mc-novedades-panel"><div class="mc-novedades-intro"><div><b>Últimos dos meses</b><p>Selección documentada de las principales editoriales españolas. Las portadas se consultan individualmente desde la ficha oficial de la editorial al visualizar las novedades. Si no están disponibles, puedes abrir la fuente.</p></div><span id="mcNovedadesCount">'+records.length+' novedades verificadas</span></div>'+
   (error?'<div class="notice">No se ha podido cargar la sección: '+sanitize(error)+'. <button class="btn sm" type="button" onclick="mcNovedadesReload()">Reintentar</button></div>':'')+
   '<div class="mc-novedades-filters"><label>Editorial<select id="mcNovedadesPublisher"><option value="">Todas las editoriales</option>'+options+'</select></label>'+
   '<label>Mes<select id="mcNovedadesMonth"><option value="">Los dos meses</option>'+monthOpts+'</select></label>'+
   '<label>Buscar<input id="mcNovedadesSearch" type="search" value="'+sanitize(ui.q)+'" placeholder="Cabecera, número o autor"></label></div>'+
   '<div id="mcNovedadesArea"></div>'+
   '<div class="mc-novedades-foot"><p><b>Editoras incluidas:</b> '+dirs+'.</p>'+
   '<p>Fecha de actualización de la selección: '+sanitize(shortDate(lastUpdate)||'sin confirmar')+'. Los lanzamientos sin día confirmado se muestran con su mes editorial. Para datos completos, consulta la fuente. Las incorporaciones a tu colección requieren guardar manualmente la ficha.</p></div></div>';
 }
 async function renderCurrent(){
   const node=document.getElementById('view');if(!node)return;
   node.innerHTML=await view();
   const pub=document.getElementById('mcNovedadesPublisher'),month=document.getElementById('mcNovedadesMonth'),q=document.getElementById('mcNovedadesSearch');
   if(pub)pub.onchange=()=>{ui.publisher=pub.value;paint()};
   if(month)month.onchange=()=>{ui.month=month.value;paint()};
   if(q)q.oninput=()=>{ui.q=q.value;paint()};
   paint();
 }
 window.mcNovedadesReload=async function(){loaded=false;await renderCurrent()};
 window.mcNovedadesDraft=async function(id,status){
   const r=records.find(x=>x.id===id);if(!r)return;
   if(typeof editComic!=='function'){toast('No se puede abrir la ficha');return}
   await editComic();
   const set=(key,value)=>{const node=document.getElementById('m_'+key);if(node&&value!==undefined&&value!==null)node.value=String(value)};
   const series=r.series||r.title;
   const issue=String(r.issueNr??'').trim()||(r.isbn?'':'Único');
   const year=String(r.startYear||r.publicationDate?.slice(0,4)||r.releaseMonth?.slice(0,4)||'');
   const fields={publisher:r.publisher,catalogHeader:series,series,title:r.title,subtitle:r.subtitle||'',issueNr:issue,volume:r.volume||'',stage:r.stage||'',startYear:year,publicationDate:r.publicationDate||'',format:r.format||'',pages:r.pages??'',status,isbn:r.isbn||'',color:r.color||'',edition:r.edition||'',arc:r.arc||'',group:r.group||'',tags:r.tags||'',coverUrl:authorizedCover(r)||'',estimated:r.estimated??'',paid:'',notes:[r.synopsis||'',r.description||'',r.authors?'Autores: '+r.authors:'',r.price!=null?'PVP editorial: '+r.price+' EUR':'','Fuente editorial: '+urlSafe(r.sourceUrl),'Novedad: '+monthLabel(r.releaseMonth)].filter(Boolean).join('\\n')};
   for(const [key,value] of Object.entries(fields))set(key,value);
   if(r.authors){set('writer',r.writer||r.authors);set('artist',r.artist||'');set('cover_artist',r.coverArtist||'');}
   // Store the full editorial record in the pending draft; do not discard fields
   // that have no equivalent form input. Persist only when the user saves.
   const modal=document.getElementById('modal');
   if(modal){modal.dataset.novedadId=r.id;modal.dataset.novedadSource=JSON.stringify(r);}
   const header=document.querySelector('.mc-comic-kicker');if(header)header.textContent='Nueva ficha desde Novedades · Revisar edición';
   const body=document.querySelector('#modal .modalbody');
   if(body){const notice=document.createElement('p');notice.className='notice';notice.textContent=issue?'Ficha preparada con datos editoriales. Revisa la edición antes de guardar.':'Ficha preparada con datos editoriales. Edición sin numeración: se ha identificado como número Único; revísalo antes de guardar.';body.prepend(notice)}
   document.getElementById('m_title')?.focus();
 };
 // Enrich the saved record with the complete source metadata, without changing
 // the user's edits or storing unlicensed cover URLs as local images.
 if(typeof window.putStore==='function'){
   const originalPut=window.putStore;
   window.putStore=async function(store,row){
     if(store==='comics'&&row&&current==='novedades'&&document.getElementById('modal')?.classList.contains('hidden')===false&&document.getElementById('modal')?.dataset.novedadSource){
       try{
         const source=JSON.parse(document.getElementById('modal').dataset.novedadSource);
         if(!row.editorialSource||row.editorialSource.id===source.id){
           row={...row,editorialSource:{...source},source:'editorial-novedades',sourceId:source.id,sourceUrl:source.sourceUrl||row.sourceUrl||'',authors:{...(row.authors||{}),unclassified:row.authors?.unclassified||source.authors||''}};
         }
       }catch(e){console.warn('Novedades metadata',e)}
     }
     const saved=await originalPut(store,row);
     // The personal catalogue must own its cover, not depend on a remote URL.
     // Attach only after the comic has a persistent id. A failed download is
     // reported explicitly; never pretend that an external URL is a saved cover.
     if(store==='comics'&&row?.id&&row?.editorialSource?.id&&row.coverUrl&&!row.coverKey&&
        !window.mcNovedadesCoverAttachInProgress&&window.CoverVault?.attach){
       window.mcNovedadesCoverAttachInProgress=true;
       try{await window.CoverVault.attach(row,row.coverUrl)}
       catch(e){
         console.warn('No se pudo guardar una copia personal de la portada:',e);
         if(typeof toast==='function')toast('Ficha guardada, pero la portada sigue siendo un enlace externo. Prueba a guardarla desde la ficha.');
       }finally{window.mcNovedadesCoverAttachInProgress=false}
     }
     return saved;
   };
 }

 const baseRender=window.render;
 if(typeof baseRender==='function')window.render=async function(...args){if(current==='novedades')return renderCurrent();return baseRender.apply(this,args)};
})();
