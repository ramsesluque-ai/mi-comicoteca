'use strict';
/* Single production V4 runtime. Keep release gate false until 2-user E2E tests
 * have validated RLS, private binary covers, reconnect/retries and Cloudflare.
 * The client stays entirely local while gated; no cloud writes are attempted.
 */
(function(root){
 const RELEASE_APPROVED=false; // Flip only after verified E2E; never from localStorage/query params.
 // Pilot remains fail-closed: only the designated UID and a fresh server-side
 // app_metadata flag can authorize this runtime. Global release stays gated.
 const PILOT_UID='f7847aa2-1243-4d04-87a8-18b41e2a1aa6';
 function candidate(){return RELEASE_APPROVED||(typeof MC_ACCOUNT_ID==='string'&&MC_ACCOUNT_ID===PILOT_UID);}
 async function authorize(options){
  if(RELEASE_APPROVED)return true;
  if(options.uid!==PILOT_UID)return false;
  const who=await root.CommercialBilling?.currentUser?.();
  if(who?.id!==options.uid)return false;
  let session=null;
  for(const store of [root.localStorage,root.sessionStorage]){
   try{const s=JSON.parse(store.getItem('mc_supabase_session_v1')||'null');if(s?.user?.id===options.uid&&s.access_token){session=s;break}}catch(_){}
  }
  if(!session||!/^https:\/\/[^/?#]+\/?$/.test(String(options.cfg?.url||'')))return false;
  const response=await fetch(options.cfg.url.replace(/\/+$/,'')+'/auth/v1/user',{headers:{apikey:options.cfg.publishableKey,Authorization:'Bearer '+session.access_token},cache:'no-store'});
  if(!response.ok)return false;
  const verified=await response.json();
  return verified?.id===options.uid&&verified?.app_metadata?.mc_sync_v4_pilot===true&&MC_ACCOUNT_ID===options.uid&&DBN===options.dbName&&db===options.database;
 }
 const STATE={enabled:RELEASE_APPROVED,running:false,scheduled:false,lastError:null,lastSuccessful:null,
  lastUploads:0,lastDownloads:0,lastConflicts:0,pending:null};
 let job=null,activeIdentity=null,timer=null,pendingRetryMode=null,lastOnReturn=0,retryMs=5000,afterJobPush=false,afterJobRefresh=false;
 function reschedulePending(sent, retryMode='push'){
  if(!candidate()||!STATE.enabled||!sent||!Number(sent.pending)||timer)return;
  const errors=sent.conflicts||[];
  const retryable=errors.length>0&&errors.every(e=>
   /(?:HTTP 5\d\d|HTTP 429|HTTP 408|HTTP 425|Failed to fetch|Load failed|Network request failed|NetworkError|network|sin conexión|timeout|offline)/i.test(String(e.reason||'')));
  // Continue unvisited revisions or transient failures even after permanent CAS conflicts.
  const canProgress=typeof sent.unattempted==='number'
   ? sent.unattempted>0||Number(sent.retryablePending)>0
   : !errors.length||retryable;
  if(!canProgress)return;
  // A pending outbox with no reported conflict is not proof of progress.
  // Avoid hammering the API every 1.5 seconds if the transport repeatedly
  // returns pending records without acknowledging any of them.
  const delay=retryMs;
  retryMs=Math.min(retryMs*2,300000);
  pendingRetryMode=retryMode;
  timer=setTimeout(()=>{
   timer=null;pendingRetryMode=null;
   STATE.scheduled=false;emit();
   work(retryMode).catch(e=>console.warn('MI COMICTECA retry de sincronización pendiente',e));
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
 function update(result,mode){
  STATE.lastError=null;STATE.lastSuccessful=new Date().toISOString();
  STATE.lastUploads=result?.sent?.uploaded||0;STATE.lastDownloads=result?.received?.downloaded||0;
  STATE.lastConflicts=(result?.sent?.conflicts?.length||0)+(result?.received?.conflicts?.length||0);
  STATE.pending=result?.sent?.pending??null;
  STATE.lastError=STATE.lastConflicts?'Hay '+STATE.lastConflicts+' cambios que requieren revisión o reconexión':null;
  // A later successful upload can overtake a previously scheduled retry.
  // Cancel that obsolete retry and reset backoff only after the outbox is
  // confirmed empty; otherwise keep the pending operation retryable.
  // An upload ACK only proves the outbox was drained. It does not prove a
  // previously failed pull/full reconciliation has recovered remote changes.
  // Preserve that retry even if a manual push completes successfully.
  const unfinishedPull=pendingRetryMode==='both'||pendingRetryMode==='pull';
  const retryDownload=Number(result?.received?.retryablePending||0)>0;
  if(!retryDownload&&result?.sent&&Number(result.sent.pending)===0&&!(mode==='push'&&unfinishedPull)){
   if(timer){clearTimeout(timer);timer=null}
   pendingRetryMode=null;
   STATE.scheduled=false;
   retryMs=5000;
  }
  emit();
  // A failed private-cover download or a local race can leave remote updates
  // unapplied even when every outgoing revision has been acknowledged.
  // Retry the full reconciliation; do not treat an empty outbox as success.
  if(retryDownload){
   if(timer&&pendingRetryMode==='push'){clearTimeout(timer);timer=null}
   reschedulePending({pending:Number(result.received.retryablePending),unattempted:0,retryablePending:Number(result.received.retryablePending),conflicts:result.received.conflicts||[]},'both');
  }else reschedulePending(result?.sent,mode);
  if(STATE.lastDownloads){
   root.dispatchEvent(new CustomEvent('mc-catalog-cloud-merged',{detail:{added:STATE.lastDownloads}}));
  }
 }
 async function work(mode){
  if(!candidate())return {paused:true,reason:'Pendiente validación E2E y despliegue en micomicteca.es'};
  if(job){
   // Never reuse a previous account's in-flight result after an auth/account switch.
   if(activeIdentity && (typeof MC_ACCOUNT_ID!=='string'||MC_ACCOUNT_ID!==activeIdentity.uid||DBN!==activeIdentity.dbName||db!==activeIdentity.database))
    throw Error('Cambio de cuenta durante sincronización; operación bloqueada');
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
    activeIdentity={uid:options.uid,dbName:options.dbName,database:options.database};
    const authorized=await authorize(options);
    // Authorization is asynchronous: do not start a transport or publish
    // status if the account changed during the authorization request.
    if(MC_ACCOUNT_ID!==options.uid||DBN!==options.dbName||db!==options.database)
     throw Error('Cambio de cuenta durante sincronización; resultado descartado');
    STATE.enabled=authorized;
    emit();
    if(!STATE.enabled)return {paused:true,reason:'Piloto no autorizado por el servidor'};
    const engine=root.MCAutoSyncV4;
    const result=mode==='push'?{sent:await engine.uploadQueued(options)}:
      mode==='pull'?{received:await engine.pull(options)}:await engine.syncNow(options);
    // Auth may change while an awaited REST request is in flight. Never
    // acknowledge its result in the UI of a different private account.
    if(MC_ACCOUNT_ID!==options.uid||DBN!==options.dbName||db!==options.database)
     throw Error('Cambio de cuenta durante sincronización; resultado descartado');
    update(result,mode);
    return result;
   }catch(e){
    // A stale request must not publish errors or schedule retries under a new UID.
    // The new account will perform its own startup/reconnection reconciliation.
    if(activeIdentity && (typeof MC_ACCOUNT_ID!=='string'||MC_ACCOUNT_ID!==activeIdentity.uid||DBN!==activeIdentity.dbName||db!==activeIdentity.database))
     throw e;
    STATE.lastError=String(e.message||e);emit();
    // Network errors can reject the transport instead of returning a pending
    // result. Retry those without acknowledging or dropping the durable outbox.
    if(/(?:HTTP 5\d\d|HTTP 429|HTTP 408|HTTP 425|Failed to fetch|Load failed|Network request failed|NetworkError|network|sin conexión|timeout|offline)/i.test(STATE.lastError)){
     // A failed initial pull or full reconciliation must retry that same operation,
     // not silently degrade to push-only (which would leave remote edits unseen).
     reschedulePending({pending:1,conflicts:[{reason:STATE.lastError}]},mode);
    }
    throw e
   }
   finally{
    // A completed request may belong to a signed-out account. Never publish its
    // completion or replay its queued work against a newly opened private DB.
    const sameAccount=activeIdentity&&
     MC_ACCOUNT_ID===activeIdentity.uid&&DBN===activeIdentity.dbName&&db===activeIdentity.database;
    const completedUid=activeIdentity?.uid,completedDbName=activeIdentity?.dbName,completedDatabase=activeIdentity?.database;
    STATE.running=false;job=null;activeIdentity=null;
    const next=sameAccount?(afterJobRefresh?'both':afterJobPush?'push':null):null;
    afterJobRefresh=false;afterJobPush=false;
    if(sameAccount)emit();
    if(next)Promise.resolve().then(()=>{
     // Recheck after the microtask boundary: auth may change in the meantime.
     if(MC_ACCOUNT_ID!==completedUid||DBN!==completedDbName||db!==completedDatabase)return;
     return work(next).catch(e=>console.warn('MI COMICTECA sincronización reprogramada pendiente',e));
    });
   }
  })();
  return job;
 }
 function queueUpload(){
  if(!candidate())return;
  // Preserve an unfinished full pull/reconciliation when a new save replaces
  // its retry timer. A push-only debounce must not suppress remote changes.
  const nextMode=pendingRetryMode==='both'||pendingRetryMode==='pull'?'both':'push';
  if(timer){clearTimeout(timer);timer=null}
  pendingRetryMode=nextMode;
  STATE.scheduled=true;emit();
  timer=setTimeout(()=>{timer=null;pendingRetryMode=null;STATE.scheduled=false;emit();work(nextMode).catch(e=>console.warn('MI COMICTECA auto-upload pendiente',e))},800);
 }
 function onReturn(){
  if(!candidate()||root.document?.hidden||Date.now()-lastOnReturn<120000)return;
  lastOnReturn=Date.now();
  work('both').catch(e=>console.warn('MI COMICTECA recuperación pendiente',e));
 }
 function begin(){
  root.addEventListener('mc-local-comic-saved',queueUpload);
  root.addEventListener('online',()=>{if(candidate())work('both').catch(e=>console.warn('Reconexión pendiente',e))});
  root.addEventListener('focus',onReturn);
  root.document?.addEventListener('visibilitychange',onReturn);
  const kick=()=>{
   if(typeof db==='undefined'||!db||root.MC_CATALOG_BOOT_PENDING){setTimeout(kick,250);return}
   if(!candidate())return;
   work('both').catch(e=>console.warn('MI COMICTECA arranque cloud pendiente',e));
  };
  setTimeout(kick,100);
 }
 const api={get enabled(){return candidate()&&STATE.enabled},syncNow:()=>work('both'),pull:()=>work('pull'),uploadQueued:()=>work('push'),
  getStatus:()=>({...STATE})};
 root.MCAutoSyncRuntimeV4=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof root.addEventListener==='function'&&root.document){
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',begin,{once:true});
  else begin();
 }
})(typeof window!=='undefined'?window:globalThis);