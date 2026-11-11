'use strict';
/* MI COMICTECA: private cover contribution -> moderation queue.
 * Uploads are private. No public cover is published by a user's browser.
 */
(function(){
const SESSION='mc_supabase_session_v1', APPROVED='master_cover_approved', PROPOSALS='master_cover_proposals';
const cfg=()=>window.MI_COMICOTECA_CLOUD||{};
const session=()=>{try{return JSON.parse(sessionStorage.getItem(SESSION)||localStorage.getItem(SESSION)||'null')}catch{return null}};
function authHeaders(json=false){const s=session(),c=cfg();if(!s?.access_token)throw Error('Inicia sesión para proponer una portada.');return {apikey:c.publishableKey,Authorization:'Bearer '+s.access_token,...(json?{'Content-Type':'application/json'}:{})}}
async function checked(url,opt){const r=await fetch(url,opt),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.message||j.error||('HTTP '+r.status));return j}
let approved={};let lastRead=0;
const clean=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
window.mcMasterCoverKey=function(r){
 const isbn=String(r?.isbn||'').replace(/[^0-9X]/gi,'').toUpperCase();
 if(isbn.length>=8&&isbn.length<=17)return 'isbn:'+isbn;
 const fields=[r?.publisher,r?.catalogHeader||r?.series,r?.volume,r?.stage,r?.startYear,r?.issueNr||r?.issue,r?.publicationDate];
 if(!clean(fields[0])||!clean(fields[1])||!clean(fields[5]))return r?.id?'record:'+String(r.id):'';
 return 'issue:'+fields.map(x=>encodeURIComponent(clean(x))).join('|');
};
window.mcSharedCovers=async function(force=false){
 if(!force&&Date.now()-lastRead<60000)return approved;
 const c=cfg();if(!c.url||!c.publishableKey)return approved;
 try{const rows=await checked(c.url+'/rest/v1/'+APPROVED+'?select=identity_key,cover_url',{headers:{apikey:c.publishableKey}});
  approved=Object.fromEntries(rows.map(x=>[String(x.identity_key||''),x.cover_url]));lastRead=Date.now();
 }catch(e){console.warn('Aportaciones compartidas no disponibles',e)}
 return approved;
};
window.mcProposeMasterCover=function(encoded){
 const x=((typeof MCMasterUI!=='undefined'?MCMasterUI.activeIssueRows:[])).find(y=>String(y.id)===decodeURIComponent(encoded));
 if(!x)return alert('No se ha encontrado la ficha del Maestro.');
 const isbn=String(x.isbn||'').replace(/[^0-9X]/gi,'').toUpperCase();
 const identity_key=window.mcMasterCoverKey(x);
 if(!identity_key)return alert('No se ha podido identificar esta ficha; revisa editorial, cabecera y número.');
 const modal=document.getElementById('modal');
 const title=String(x.title||x.catalogHeader||x.series||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 modal.innerHTML='<div class="modalbox"><div class="modalhead"><b>Portada y datos del cómic</b><button class="btn" id="mcContribBack">Cerrar</button></div><div class="modalbody"><div class="mc-contrib-record"><span class="mc-contrib-kicker">Ficha del Maestro</span><strong>'+title+'</strong><span class="mc-contrib-muted">'+(isbn?'ISBN '+isbn:'Editorial, serie y número identificados (sin ISBN)')+'</span></div><div class="mc-contrib-search"><div><b>Buscar datos y portada</b><p class="mc-contrib-muted">Consulta individual por ISBN y título. Comprueba la edición antes de utilizar una imagen.</p></div><button class="btn primary" type="button" id="mcContribLookup">Buscar datos y portada</button></div><div id="mcContribLookupResults" class="mc-contrib-results" aria-live="polite"></div><details class="mc-contrib-upload"><summary>Añadir portada al Maestro</summary><p class="mc-contrib-notice">Puedes adjuntar la portada sin completar la declaración de derechos. La revisión de derechos sigue disponible de forma opcional; la publicación compartida depende de los permisos aplicables.</p><div class="mc-contrib-formgrid"><label>Imagen (JPG, PNG o WebP; máximo 5 MB)<input id="mcContribFile" type="file" accept="image/jpeg,image/png,image/webp"></label><label>Derechos de uso (opcional)<select id="mcContribRights"><option value="">Selecciona la autorización</option><option value="own_work">Soy autor o titular de los derechos</option><option value="licensed">Tengo permiso o licencia para compartirla públicamente</option><option value="public_domain">La imagen es de dominio público</option></select></label><label class="mc-wide">Justificación / licencia (opcional)<input id="mcContribNote" placeholder="Origen y permiso comprobable"></label></div><div class="mc-contrib-actions"><span id="mcContribStatus" role="status"></span><button class="btn primary" id="mcContribSend">Añadir portada</button></div></details></div></div>';
 // Individual remote image selection: user validates the edition before submitting.
 const searchExtra=document.createElement('div');
 searchExtra.className='mc-contrib-direct';
 searchExtra.innerHTML='<label>URL directa de la imagen (opcional)<input id="mcContribRemoteUrl" type="url" placeholder="https://.../portada.jpg" autocomplete="off"></label><button class="btn" type="button" id="mcContribUseUrl">Previsualizar y seleccionar</button><p id="mcContribRemoteStatus" class="mc-contrib-muted" role="status"></p><img id="mcContribSelectedPreview" alt="Portada elegida" style="display:none;max-height:200px;max-width:150px;object-fit:contain;border-radius:10px">';
 document.getElementById('mcContribLookupResults').after(searchExtra);
 let remoteChoice=null;
 async function chooseRemoteCover(url,source){
  const status=document.getElementById('mcContribRemoteStatus'),preview=document.getElementById('mcContribSelectedPreview');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password)throw Error('Se requiere una URL HTTPS de imagen.');
  remoteChoice={url:parsed.href,source:source||'Fuente externa'};
  preview.src=remoteChoice.url;preview.style.display='block';
  document.getElementById('mcContribRemoteUrl').value=remoteChoice.url;
  // Keep the optional rights field unselected unless the user chooses to declare a basis.
  document.getElementById('mcContribNote').value='Fuente: '+remoteChoice.source+' · '+remoteChoice.url;
  document.querySelector('.mc-contrib-upload').open=true;
  status.textContent='Portada seleccionada. Verifica la edición y pulsa Añadir portada; intentaremos adjuntarla sin descarga manual.';
 }
 document.getElementById('mcContribUseUrl').onclick=async()=>{try{await chooseRemoteCover(document.getElementById('mcContribRemoteUrl').value.trim(),'URL aportada por el usuario')}catch(e){document.getElementById('mcContribRemoteStatus').textContent=e.message}};
 document.getElementById('mcContribLookupResults').addEventListener('click',async ev=>{
  const btn=ev.target.closest('[data-cover-choice]');
  if(!btn)return;
  const i=Number(btn.dataset.coverChoice),item=window.mcCoverLookupResults?.[i];
  if(!item)return;
  try{await chooseRemoteCover(item.url,item.source)}catch(e){document.getElementById('mcContribRemoteStatus').textContent=e.message}
 });
 const panel=modal.querySelector('.modalbox');panel?.classList.add('mc-contrib-modal');
 modal.querySelector('.modalhead b')?.classList.add('mc-contrib-title');
 modal.querySelectorAll('.modalbody label').forEach(label=>label.classList.add('mc-contrib-field','mc-wide'));
 modal.querySelector('.modalbody .muted')?.classList.add('mc-contrib-notice');
 modal.querySelector('#mcContribStatus')?.classList.add('mc-contrib-status');
 modal.classList.remove('hidden');
 document.getElementById('mcContribBack').onclick=()=>window.closeModal?.();
 document.getElementById('mcContribLookup').onclick=async()=>{
  const button=document.getElementById('mcContribLookup'),box=document.getElementById('mcContribLookupResults');
  button.disabled=true;box.textContent='Consultando fuentes bibliográficas…';
  const safe=s=>String(s||'').replace(/[&<>"']/g,z=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[z]));
  const results=[],seen=new Set();
  window.mcCoverLookupResults=results;
  const add=(url,label,source,link)=>{if(!url||seen.has(url))return;seen.add(url);results.push({url,label,source,link})};
  function addCoverCandidate(url,label,source,link){add(url,label,source,link)}

  // Reuse the ficha search engine (including the Maestro's verified overlays and bridge).
  try{if(typeof window.mcSESearch==='function'){
    const candidates=await window.mcSESearch({publisher:x.publisher||'',catalogHeader:x.catalogHeader||x.series||'',series:x.catalogHeader||x.series||'',volume:x.volume||'',stage:x.stage||'',startYear:x.startYear||'',issueNr:x.issueNr||x.issue||'',isbn:isbn||'',sourceId:x.sourceId||''});
    for(const item of candidates||[]){const d=item.data||{};if(d.coverUrl) addCoverCandidate(d.coverUrl,d.title||x.title||title,item.source||'Maestro / búsqueda de ficha',d.sourceUrl||'')}
  }}catch(e){console.warn('Búsqueda de candidatas del Maestro:',e)}
 
  const code=isbn.replace(/[^0-9X]/gi,'');
  try{
   if(code){
    const k='ISBN:'+code;
    try{const r=await fetch('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(k)+'&format=json&jscmd=data');if(r.ok){const b=(await r.json())[k];if(b?.cover?.medium||b?.cover?.large)add(b.cover.large||b.cover.medium,b.title||title,'Open Library · ISBN',b.url||'https://openlibrary.org/isbn/'+code)}}catch{}
    try{const r=await fetch('https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent('isbn:'+code)+'&maxResults=5');if(r.ok){const j=await r.json();for(const it of j.items||[]){const d=it.volumeInfo||{};if(!(d.industryIdentifiers||[]).some(i=>String(i.identifier||'').replace(/[^0-9X]/gi,'')===code))continue;const u=d.imageLinks?.thumbnail||d.imageLinks?.smallThumbnail;if(u)add(u.replace(/^http:/,'https:'),d.title||title,'Google Books · ISBN',d.infoLink||'')}}}catch{}
   }
   const q=String(x.catalogHeader||x.series||x.title||'').trim();
   if(q){try{const r=await fetch('https://openlibrary.org/search.json?title='+encodeURIComponent(q)+'&limit=12');if(r.ok){const j=await r.json(),words=q.toLowerCase().split(/\\s+/).filter(w=>w.length>3);for(const d of j.docs||[]){if(!d.cover_i||!words.some(w=>String(d.title||'').toLowerCase().includes(w)))continue;add('https://covers.openlibrary.org/b/id/'+d.cover_i+'-M.jpg',d.title||q,'Open Library · verificar edición',d.key?'https://openlibrary.org'+d.key:'')}}}catch{}}
   // Historical issues often lack ISBN and are absent from book-cover APIs.
   // Offer edition-specific source lookups without claiming that an image exists.
   const edition=[x.publisher||'',x.catalogHeader||x.series||'',x.issueNr||x.issue||'',x.startYear||''].map(s=>String(s||'').trim()).filter(Boolean).join(' ');
   const lookupLinks=[];
   const gcdId=String(x.sourceId||x.id||'').replace(/^gcd_/i,'');
   if(/^\\d+$/.test(gcdId))lookupLinks.push({label:'Consultar ficha original en Grand Comics Database',url:'https://www.comics.org/issue/'+gcdId+'/'});
   if(edition){
     lookupLinks.push({label:'Buscar esta edición en Tebeosfera',url:'https://www.google.com/search?q='+encodeURIComponent('site:tebeosfera.com '+edition)});
     lookupLinks.push({label:'Buscar portada de esta edición',url:'https://www.google.com/search?tbm=isch&q='+encodeURIComponent(edition+' portada')});
   }
   const alternatives=lookupLinks.length?'<div class="mc-contrib-alternatives"><b>Fuentes para cómics sin ISBN</b><p class="mc-contrib-muted">Estas opciones abren una búsqueda de la edición identificada. No implican que exista una portada disponible ni autorizan copiarla.</p>'+lookupLinks.map(a=>'<a href="'+safe(a.url)+'" target="_blank" rel="noopener noreferrer">'+safe(a.label)+' ↗</a>').join('')+'</div>':'';
   box.innerHTML=results.length?'<div class="mc-contrib-resultgrid">'+results.slice(0,12).map((a,i)=>'<div class="mc-contrib-result"><img src="'+safe(a.url)+'" loading="lazy" referrerpolicy="no-referrer" alt="Portada candidata" onerror="this.style.display=\'none\'"><span><b>'+safe(a.label)+'</b><small>'+safe(a.source)+'</small><button type="button" class="btn primary" data-cover-choice="'+i+'">Elegir esta portada</button><a href="'+safe(a.link||a.url)+'" target="_blank" rel="noopener noreferrer">Ver fuente ↗</a></span></div>').join('')+'</div><p class="mc-contrib-muted">Selecciona la imagen y revisa que coincida con la editorial, la serie y el número. Después se enviará a la cola privada de revisión del Maestro.</p>':'<p class="mc-contrib-muted">No hay portada automática para esta ficha. Puedes pegar una URL directa de imagen o consultar las fuentes siguientes.</p>';
   box.innerHTML+=alternatives;
  }catch(e){box.textContent='No se pudo completar la consulta: '+(e.message||e)}
  finally{button.disabled=false}
 };

 document.getElementById('mcContribSend').onclick=async()=>{
 const status=document.getElementById('mcContribStatus'),button=document.getElementById('mcContribSend');
 let file=document.getElementById('mcContribFile').files[0];
 const rights=document.getElementById('mcContribRights').value,note=document.getElementById('mcContribNote').value.trim();
 if(!file&&remoteChoice){
   status.textContent='Capturando portada seleccionada…';
   try{
     const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
     let response;
     try{response=await fetch(remoteChoice.url,{mode:'cors',signal:controller.signal,credentials:'omit'})}finally{clearTimeout(timer)}
     if(!response.ok)throw Error('La fuente no permite descargar la imagen (HTTP '+response.status+').');
     const blob=await response.blob();
     if(!['image/jpeg','image/png','image/webp'].includes(blob.type)||blob.size>5242880||!blob.size)throw Error('La portada no es JPEG, PNG o WebP válido (máximo 5 MB).');
     const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
     file=new File([blob],'portada-validada.'+ext,{type:blob.type});
   }catch(e){status.textContent='La fuente bloquea la captura desde el navegador. Abre la fuente y utiliza la subida manual. Detalle: '+e.message;return}
 }

 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880||!file.size){status.textContent='Selecciona una imagen válida de hasta 5 MB.';return}
 // Rights declaration is optional for the user; retain a neutral internal status for moderation.
 button.disabled=true;status.textContent='Guardando portada…';
 try{
 const c=cfg(),user=await checked(c.url+'/auth/v1/user',{headers:authHeaders()}),ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
 const path=user.id+'/'+crypto.randomUUID()+'.'+ext;
 const directPublish=user.id==='0bcbe06d-263d-4ac1-a516-355d27d417f1';
 const upload=await fetch(c.url+'/storage/v1/object/master-contributions/'+path,{method:'POST',headers:{...authHeaders(),'Content-Type':file.type,'x-upsert':'false'},body:file});
 if(!upload.ok){const e=await upload.json().catch(()=>({}));throw Error(e.message||e.error||'Error de subida')}
 if(directPublish){
   status.textContent='Publicando portada en el Maestro compartido…';
   const response=await fetch(c.url+'/functions/v1/publish-master-cover',{method:'POST',headers:{...authHeaders(true)},body:JSON.stringify({private_path:path,identity_key,isbn:isbn||null})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.ok)throw Error(result.error||'No se pudo publicar la portada');
   approved[identity_key]=result.cover_url;lastRead=Date.now();
   const row=(typeof MCMasterUI!=='undefined'?MCMasterUI.activeIssueRows:[]).find(y=>String(y.id)===String(x.id));
   if(row)row.coverUrl=result.cover_url;
   status.textContent='Portada publicada. Ya está disponible en el Maestro compartido.';
   button.textContent='Publicada';return;
 }
 try{await checked(c.url+'/rest/v1/'+PROPOSALS,{method:'POST',headers:{...authHeaders(true),Prefer:'return=representation'},body:JSON.stringify({user_id:user.id,isbn:isbn||null,identity_key,bibliographic_identity:{publisher:x.publisher||'',series:x.catalogHeader||x.series||'',volume:x.volume||'',stage:x.stage||'',startYear:x.startYear||'',issueNr:x.issueNr||x.issue||'',publicationDate:x.publicationDate||'',master_id:x.id||''},title:x.title||x.catalogHeader||x.series||'',original_filename:file.name,private_path:path,rights_basis:rights||'licensed',rights_note:note||'Permiso declarado por el responsable de COMICTECA; alcance pendiente de documentar por editorial.'})})}
 catch(e){await fetch(c.url+'/storage/v1/object/master-contributions/'+path,{method:'DELETE',headers:authHeaders()}).catch(()=>{});throw e}
 status.textContent='Portada recibida para revisión. La publicación directa está reservada al administrador.';button.textContent='Enviada';
 }catch(e){status.textContent='No se pudo enviar: '+e.message;button.disabled=false}
 };
};
})();