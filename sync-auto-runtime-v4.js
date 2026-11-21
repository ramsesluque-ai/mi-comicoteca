'use strict';
/* Single production V4 runtime. Keep release gate false until 2-user E2E tests
 * have validated RLS, private binary covers, reconnect/retries and Cloudflare.
 * The client stays entirely local while gated; no cloud writes are attempted.
 */
(function(root){
 const RELEASE_APPROVED=false; // Flip only after verified E2E; never from localStorage/query params.
 const STATE={enabled:RELEASE_APPROVED,running:false,scheduled:false,lastError:null,lastSuccessful:null,
  lastUploads:0,lastDownloads:0,lastConflicts:0,pending:null};
 let job=null,timer=null,lastOnReturn=0,retryMs=5000,afterJobPush=false,afterJobRefresh=false;
 function reschedulePending(sent){
  if(!RELEASE_APPROVED||!sent||!Number(sent.pending)||timer)return;
  const errors=sent.conflicts||[];
  const retryable=errors.length>0&&errors.every(e=>
   /(?:HTTP 5\d\d|HTTP 429|Failed to fetch|NetworkError|network|sin conexión|timeout|offline)/i.test(String(e.reason||'')));
  if(errors.length&&!retryable)return; // Real conflict requires user review, not a busy loop.
  const delay=retryable?retryMs:1500;
  if(retryable)retryMs=Math.min(retryMs*2,300000);
  else retryMs=5000;
  timer=setTimeout(()=>{
   timer=null;
   STATE.scheduled=false;emit();
   work('push').catch(e=>console.warn('MI COMICTECA retry de sincronización pendiente',e));
  },delay);
  STATE.scheduled=true;emit();
 }
 const emit=()=>{try{root.dispatchEvent(new CustomEvent('mc-sync-v4-status',{detail:{...STATE}}))}catch(_){}};
 function context(){
  if(typeof db==='undefined'||!db||typeof DBN!=='string'||typeof MC_ACCOUNT_ID!=='string'||!MC_ACCOUNT_ID)throw Error('Colección local no preparada');
  if(typeof MC_IMPORT_TEST==='boolean'&&MC_IMPORT_TEST)throw Error('La demo no se sincroniza');
  // Never allow a stale browser session to pair one account's IndexedDB with another UID.
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(MC_ACCOUNT_ID)||DBN!=='comicteca-user-'+MC_ACCOUNT_ID)
   throw Error('Cuenta y almacén privado no coinciden; sincronización bloqueada');
  if(!root.MCAutoSyncV4||!root.MCAutoCoversV4)throw Error('Motor de sincronización privada no cargado');
  return {database:db,dbName:DBN,uid:MC_ACCOUNT_ID,cfg:root.MI_COMICOTECA_CLOUD,coverTransport:root.MCAutoCoversV4};
 }
 function update(result){
  STATE.lastError=null;STATE.lastSuccessful=new Date().toISOString();
  STATE.lastUploads=result?.sent?.uploaded||0;STATE.lastDownloads=result?.received?.downloaded||0;
  STATE.lastConflicts=(result?.sent?.conflicts?.length||0)+(result?.received?.conflicts?.length||0);
  STATE.pending=result?.sent?.pending??null;
  STATE.lastError=STATE.lastConflicts?'Hay '+STATE.lastConflicts+' cambios que requieren revisión o reconexión':null;
  emit();
  reschedulePending(result?.sent);
  if(STATE.lastDownloads){
   root.dispatchEvent(new CustomEvent('mc-catalog-cloud-merged',{detail:{added:STATE.lastDownloads}}));
  }
 }
 async function work(mode){
  if(!RELEASE_APPROVED)return {paused:true,reason:'Pendiente validación E2E y despliegue en micomicteca.es'};
  if(job){
   // A save may happen while the initial 16k-record cloud scan is running.
   // Never let that save request vanish behind the already-running job.
   if(mode==='both'||mode==='pull')afterJobRefresh=true;
   else if(mode==='push')afterJobPush=true;
   return job;
  }
  job=(async()=>{
   STATE.running=true;emit();
   try{
    const options=context();
    const engine=root.MCAutoSyncV4;
    const result=mode==='push'?{sent:await engine.uploadQueued(options)}:
      mode==='pull'?{received:await engine.pull(options)}:await engine.syncNow(options);
    update(result);
    return result;
   }catch(e){
    STATE.lastError=String(e.message||e);emit();
    // Network errors can reject the transport instead of returning a pending
    // result. Retry those without acknowledging or dropping the durable outbox.
    if(/(?:HTTP 5\\d\\d|HTTP 429|Failed to fetch|NetworkError|network|sin conexión|timeout|offline)/i.test(STATE.lastError)){
     reschedulePending({pending:1,conflicts:[{reason:STATE.lastError}]});
    }
    throw e
   }
   finally{
    STATE.running=false;job=null;emit();
    const next=afterJobRefresh?'both':afterJobPush?'push':null;
    afterJobRefresh=false;afterJobPush=false;
    if(next)Promise.resolve().then(()=>work(next).catch(e=>console.warn('MI COMICTECA sincronización reprogramada pendiente',e)));
   }
  })();
  return job;
 }
 function queueUpload(){
  if(!RELEASE_APPROVED)return;
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>{timer=null;STATE.scheduled=false;work('push').catch(e=>console.warn('MI COMICTECA auto-upload pendiente',e))},800);
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