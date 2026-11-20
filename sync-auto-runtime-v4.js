'use strict';
/* Single production V4 runtime. Keep release gate false until 2-user E2E tests
 * have validated RLS, private binary covers, reconnect/retries and Cloudflare.
 * The client stays entirely local while gated; no cloud writes are attempted.
 */
(function(root){
 const RELEASE_APPROVED=false; // Flip only after verified E2E; never from localStorage/query params.
 const STATE={enabled:RELEASE_APPROVED,running:false,scheduled:false,lastError:null,lastSuccessful:null,
  lastUploads:0,lastDownloads:0,lastConflicts:0,pending:null};
 let job=null,timer=null,lastOnReturn=0;
 const emit=()=>{try{root.dispatchEvent(new CustomEvent('mc-sync-v4-status',{detail:{...STATE}}))}catch(_){}};
 function context(){
  if(typeof db==='undefined'||!db||typeof DBN!=='string'||typeof MC_ACCOUNT_ID!=='string'||!MC_ACCOUNT_ID)throw Error('Colección local no preparada');
  if(typeof MC_IMPORT_TEST==='boolean'&&MC_IMPORT_TEST)throw Error('La demo no se sincroniza');
  if(!root.MCAutoSyncV4||!root.MCAutoCoversV4)throw Error('Motor de sincronización privada no cargado');
  return {database:db,dbName:DBN,uid:MC_ACCOUNT_ID,cfg:root.MI_COMICOTECA_CLOUD,coverTransport:root.MCAutoCoversV4};
 }
 function update(result){
  STATE.lastError=null;STATE.lastSuccessful=new Date().toISOString();
  STATE.lastUploads=result?.sent?.uploaded||0;STATE.lastDownloads=result?.received?.downloaded||0;
  STATE.lastConflicts=(result?.sent?.conflicts?.length||0)+(result?.received?.conflicts?.length||0);
  STATE.pending=result?.sent?.pending??null;
  emit();
  if(STATE.lastDownloads){
   root.dispatchEvent(new CustomEvent('mc-catalog-cloud-merged',{detail:{added:STATE.lastDownloads}}));
  }
 }
 async function work(mode){
  if(!RELEASE_APPROVED)return {paused:true,reason:'Pendiente validación E2E y despliegue en micomicteca.es'};
  if(job)return job;
  job=(async()=>{
   STATE.running=true;emit();
   try{
    const options=context();
    const engine=root.MCAutoSyncV4;
    const result=mode==='push'?{sent:await engine.uploadQueued(options)}:
      mode==='pull'?{received:await engine.pull(options)}:await engine.syncNow(options);
    update(result);
    return result;
   }catch(e){STATE.lastError=String(e.message||e);emit();throw e}
   finally{STATE.running=false;job=null;emit()}
  })();
  return job;
 }
 function queueUpload(){
  if(!RELEASE_APPROVED)return;
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>{timer=null;work('push').catch(e=>console.warn('MI COMICTECA auto-upload pendiente',e))},800);
 }
 function onReturn(){
  if(!RELEASE_APPROVED||root.document?.hidden||Date.now()-lastOnReturn<120000)return;
  lastOnReturn=Date.now();
  work('both').catch(e=>console.warn('MI COMICTECA recuperación pendiente',e));
 }
 function begin(){
  root.addEventListener('mc-local-comic-saved',queueUpload);
  root.addEventListener('online',()=>{if(RELEASE_APPROVED)work('both').catch(e=>console.warn('Reconexión pendiente',e))});
  root.addEventListener('focus',onReturn);
  root.document?.addEventListener('visibilitychange',onReturn);
  if(!RELEASE_APPROVED)return;
  const kick=()=>{
   if(typeof db==='undefined'||!db||root.MC_CATALOG_BOOT_PENDING){setTimeout(kick,250);return}
   work('both').catch(e=>console.warn('MI COMICTECA arranque cloud pendiente',e));
  };
  setTimeout(kick,100);
 }
 const api={enabled:RELEASE_APPROVED,syncNow:()=>work('both'),pull:()=>work('pull'),uploadQueued:()=>work('push'),
  getStatus:()=>({...STATE})};
 root.MCAutoSyncRuntimeV4=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof root.addEventListener==='function'&&root.document){
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',begin,{once:true});
  else begin();
 }
})(typeof window!=='undefined'?window:globalThis);