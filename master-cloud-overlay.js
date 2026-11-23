'use strict';
/* Cloud overlay for the public Maestro. Static snapshots remain a read-only fallback.
 * Never writes to the user's collection or to the shared catalog.
 * Shared DB changes become visible on the next publisher load without a GitHub deploy.
 */
(function(){
 const original=window.mcMasterLoadPublisher;
 if(typeof original!=='function')return;
 const ttl=60000,cache=new Map();
 const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 function session(){
  for(const store of [localStorage,sessionStorage]){
   try{const s=JSON.parse(store.getItem('mc_supabase_session_v1')||'null');if(s?.access_token&&s?.user?.id)return s}catch(_){}
  }
  return null;
 }
 async function cloudRows(publisher){
  const config=window.MI_COMICOTECA_CLOUD,s=session();
  if(!config?.url||!config?.publishableKey||!s)return null;
  const now=Date.now(),prior=cache.get(publisher);
  if(prior&&now-prior.at<ttl)return prior.rows;
  const headers={apikey:config.publishableKey,Authorization:'Bearer '+s.access_token};
  const endpoint=config.url.replace(/\/$/,'')+'/rest/v1/';
  const seriesURL=endpoint+'master_series?select=id,publisher,title,volume,stage,start_year&publisher=eq.'+encodeURIComponent(publisher)+'&limit=1000';
  const seriesResponse=await fetch(seriesURL,{headers,cache:'no-store'});
  if(!seriesResponse.ok)throw Error('Maestro central: lectura de colecciones HTTP '+seriesResponse.status);
  const series=await seriesResponse.json();
  if(!Array.isArray(series))throw Error('Maestro central: formato de colecciones incorrecto');
  const result=[];
  // Query by series ID to avoid cross-publisher exposure and URL length limits.
  for(const group of series){
   let offset=0;
   while(true){
    const url=endpoint+'master_comics?select=id,series_id,issue_number,title,publication_date,isbn,barcode,cover_url,metadata&series_id=eq.'+encodeURIComponent(group.id)+'&order=issue_number.asc&limit=1000&offset='+offset;
    const response=await fetch(url,{headers,cache:'no-store'});
    if(!response.ok)throw Error('Maestro central: lectura de números HTTP '+response.status);
    const issues=await response.json();
    if(!Array.isArray(issues))throw Error('Maestro central: formato de números incorrecto');
    for(const issue of issues)result.push({
     id:'cloud-master-'+issue.id,publisher:group.publisher,
     catalogHeader:group.title,series:group.title,volume:group.volume||'',
     stage:group.stage||'',startYear:group.start_year?String(group.start_year):'',
     issueNr:String(issue.issue_number||''),issue:String(issue.issue_number||''),
     title:issue.title||'',publicationDate:issue.publication_date||'',
     isbn:issue.isbn||'',barcode:issue.barcode||'',coverUrl:issue.cover_url||'',
     ...(issue.metadata&&typeof issue.metadata==='object'&&!Array.isArray(issue.metadata)?{cloudMetadata:issue.metadata}:{})
    });
    if(issues.length<1000)break;
    offset+=1000;
   }
  }
  cache.set(publisher,{at:now,rows:result});
  return result;
 }
 window.mcMasterLoadPublisher=async function(publisher){
  const base=await original(publisher);
  let central;
  try{central=await cloudRows(publisher)}catch(error){console.warn('[Maestro] No disponible la actualización central; se conserva el catálogo de referencia',error);return base}
  if(!central?.length)return base;
  const key=r=>[normalize(r.publisher),normalize(r.catalogHeader||r.series),normalize(r.volume),normalize(r.stage),normalize(r.startYear),normalize(r.issueNr||r.issue)].join('|');
  const merged=base.slice(),positions=new Map();
  merged.forEach((r,i)=>{const k=key(r);if(!positions.has(k))positions.set(k,i)});
  for(const r of central){
   const k=key(r),i=positions.get(k);
   if(i===undefined){positions.set(k,merged.length);merged.push(r)}
   else {
    // Central edits win only for non-empty values; retain static bibliographic
    // fields, original cover and provenance when cloud fields are not supplied.
    const previous=merged[i],patch={};
    for(const field of ['title','publicationDate','isbn','barcode','coverUrl'])
     if(r[field]!==undefined&&r[field]!==null&&String(r[field]).trim())patch[field]=r[field];
    merged[i]={...previous,...patch,cloudMasterId:r.id};
   }
  }
  return merged;
 };
 // User contributions are proposals, not direct edits to shared bibliographic data.
 // Editorial novedades can use the same queue with source_type='novedades'.
 window.mcMasterSubmitProposal=async function(input){
  const config=window.MI_COMICOTECA_CLOUD,auth=session();
  if(!config?.url||!config?.publishableKey||!auth?.user?.id)throw Error('Inicia sesión para proponer una corrección al Maestro');
  const publisher=String(input?.publisher||'').trim();
  const seriesTitle=String(input?.seriesTitle||input?.catalogHeader||'').trim();
  const issueNumber=String(input?.issueNumber??input?.issueNr??'').trim();
  if(!publisher||!seriesTitle||!issueNumber)throw Error('Editorial, colección y número son obligatorios');
  const allowed=['title','publicationDate','isbn','barcode','coverUrl','notes','originalEdition','equivalences'];
  const proposed={};
  for(const field of allowed)if(typeof input[field]==='string'&&input[field].trim())proposed[field]=input[field].trim();
  if(!Object.keys(proposed).length)throw Error('No hay datos bibliográficos nuevos que proponer');
  const target=input?.targetComicId;
  if(target&&!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(target)))throw Error('Identificador de ficha central inválido');
  const sourceType=input?.sourceType==='novedades'?'novedades':'user';
  const payload={author_uid:auth.user.id,publisher,series_title:seriesTitle,issue_number:issueNumber,
   proposed_fields:proposed,source_type:sourceType,
   source_reference:String(input?.sourceReference||'').slice(0,2000)};
  if(target)payload.target_comic_id=target;
  const response=await fetch(config.url.replace(/\/$/,'')+'/rest/v1/master_change_proposals',{
   method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+auth.access_token,
    'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(payload)
  });
  if(!response.ok)throw Error('No se ha podido registrar la propuesta ('+response.status+')');
  return {status:'pending'};
 };
 // A small, delegated contribution action inside the existing Master issue modal.
 // Never auto-publish browser-submitted bibliographic changes.
 document.addEventListener('click',async event=>{
  const button=event.target?.closest?.('[data-master-propose]');
  if(!button)return;
  const id=button.getAttribute('data-master-propose');
  const comic=(window.MCMasterUI?.activeIssueRows||[]).find(x=>String(x.id)===id);
  if(!comic){window.toast?.('No se ha encontrado la ficha para proponer el cambio');return}
  const title=prompt('Proponer un título para '+(comic.catalogHeader||comic.series)+' n.º '+comic.issueNr,comic.title||'');
  if(title===null||!title.trim()||title.trim()===String(comic.title||'').trim())return;
  button.disabled=true;
  try{
   await window.mcMasterSubmitProposal({publisher:comic.publisher,seriesTitle:comic.catalogHeader||comic.series,
    issueNumber:comic.issueNr||comic.issue,title:title.trim(),
    targetComicId:String(comic.id||'').startsWith('cloud-master-')?String(comic.id).slice(13):undefined});
   window.toast?.('Corrección recibida. Pendiente de revisión.');
  }catch(error){window.toast?.('No se pudo enviar la corrección: '+error.message)}
  finally{button.disabled=false}
 });
 window.mcMasterCloudInvalidate=()=>cache.clear();
})();
