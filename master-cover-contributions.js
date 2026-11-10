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
const clean=s=>String(s||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toLocaleLowerCase('es');
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
 modal.innerHTML='<div class="modalbox"><div class="modalhead"><b>Proponer portada al Maestro</b><button class="btn" id="mcContribBack">Cerrar</button></div><div class="modalbody"><p><b>'+title+'</b> · '+(isbn?'ISBN '+isbn:'Editorial, serie y número identificados (sin ISBN)')+'</p><p class="muted">La portada se guarda en privado. Solo será visible para todos después de revisar derechos y coincidencia del cómic.</p><label>Imagen (JPG, PNG o WebP; máximo 5 MB)<input id="mcContribFile" type="file" accept="image/jpeg,image/png,image/webp"></label><label>Derechos de uso<select id="mcContribRights"><option value="">Selecciona la autorización</option><option value="own_work">Soy autor o titular de los derechos</option><option value="licensed">Tengo permiso o licencia para compartirla públicamente</option><option value="public_domain">La imagen es de dominio público</option></select></label><label>Justificación / licencia<input id="mcContribNote" placeholder="Origen y permiso comprobable"></label><p id="mcContribStatus" role="status"></p><button class="btn primary" id="mcContribSend">Enviar para revisión</button></div></div>';
 modal.classList.remove('hidden');
 document.getElementById('mcContribBack').onclick=()=>window.closeModal?.();
 document.getElementById('mcContribSend').onclick=async()=>{
 const status=document.getElementById('mcContribStatus'),button=document.getElementById('mcContribSend');
 const file=document.getElementById('mcContribFile').files[0],rights=document.getElementById('mcContribRights').value,note=document.getElementById('mcContribNote').value.trim();
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880||!file.size){status.textContent='Selecciona una imagen válida de hasta 5 MB.';return}
 if(!rights||!note){status.textContent='Indica los derechos de uso y su justificación.';return}
 button.disabled=true;status.textContent='Guardando propuesta privada…';
 try{
 const c=cfg(),user=await checked(c.url+'/auth/v1/user',{headers:authHeaders()}),ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
 const path=user.id+'/'+crypto.randomUUID()+'.'+ext;
 const upload=await fetch(c.url+'/storage/v1/object/master-contributions/'+path,{method:'POST',headers:{...authHeaders(),'Content-Type':file.type,'x-upsert':'false'},body:file});
 if(!upload.ok){const e=await upload.json().catch(()=>({}));throw Error(e.message||e.error||'Error de subida')}
 try{await checked(c.url+'/rest/v1/'+PROPOSALS,{method:'POST',headers:{...authHeaders(true),Prefer:'return=representation'},body:JSON.stringify({user_id:user.id,isbn:isbn||null,identity_key,bibliographic_identity:{publisher:x.publisher||'',series:x.catalogHeader||x.series||'',volume:x.volume||'',stage:x.stage||'',startYear:x.startYear||'',issueNr:x.issueNr||x.issue||'',publicationDate:x.publicationDate||'',master_id:x.id||''},title:x.title||x.catalogHeader||x.series||'',original_filename:file.name,private_path:path,rights_basis:rights,rights_note:note})})}
 catch(e){await fetch(c.url+'/storage/v1/object/master-contributions/'+path,{method:'DELETE',headers:authHeaders()}).catch(()=>{});throw e}
 status.textContent='Propuesta enviada. Queda pendiente de revisión. No está publicada para otros usuarios.';button.textContent='Enviada';
 }catch(e){status.textContent='No se pudo enviar: '+e.message;button.disabled=false}
 };
};
})();