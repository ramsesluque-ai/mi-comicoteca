'use strict';
/* MI COMICTECA V4 private-cover transport. This module is inert until called by
 * the authenticated automatic-sync controller; no background uploads here.
 * Every object lives under the authenticated UID, never in a shared public URL.
 */
(function(root){
 const BUCKET='user-covers',LEGACY='mi-comicoteca-cover-vault-v1';
 const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1',MAX=20*1024*1024;
 const check=(x,msg)=>{if(!x)throw Error(msg)};
 const cacheName=uid=>'mi-comicoteca-cover-user-'+uid;
 const cacheUrl=key=>'https://mi-comicoteca.local/cover/'+encodeURIComponent(key);
 function validate({record,uid,session,cfg}){
  check(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(uid),'Cuenta privada inválida');
  check(session?.user?.id===uid&&session.access_token,'La sesión no coincide con el usuario');
  check(root.MC_ACCOUNT_ID===uid||(
    // MC_ACCOUNT_ID is a top-level const in app1.js, not a window property.
    typeof root.MC_ACCOUNT_ID==='undefined' &&
    typeof DBN==='string'&&DBN==='comicteca-user-'+uid
  ),'La base de portadas no coincide con la cuenta');
  check(cfg?.publishableKey&&/^https:\/\/[^/?#]+\/?$/.test(String(cfg.url||'')),'Endpoint Storage inválido');
  const key=String(record?.coverKey||''),id=String(record?.id||'');
  check(/^[a-zA-Z0-9_.-]{1,180}$/.test(key),'Identificador de portada inválido');
  check(/^[a-zA-Z0-9_.:-]{1,180}$/.test(id),'Identificador de cómic inválido');
  return key;
 }
 const mimeFromBlob=async b=>{
  check(b&&b.size>0&&b.size<=MAX,'La portada está vacía o supera el límite');
  const bytes=new Uint8Array(await b.slice(0,16).arrayBuffer());
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
  if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return 'image/png';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  throw Error('El archivo de portada no es una imagen JPEG, PNG o WebP válida');
 };
 async function integrity(blob){
  const mime=await mimeFromBlob(blob);
  const dig=await root.MCSyncV2CoverIntegrity?.sha256?.(blob);
  check(/^[a-f0-9]{64}$/.test(String(dig||'')),'No se pudo verificar la huella de portada');
  return {sha256:dig,mime};
 }
 async function fromCache(uid,key,{legacyFallback=false}={}){
  check(root.caches?.open,'CacheStorage no disponible');
  const privateCache=await root.caches.open(cacheName(uid));
  let response=await privateCache.match(cacheUrl(key));
  if(!response&&legacyFallback&&uid===OWNER){
   // Existing owner's previously saved images can be imported individually.
   // Other users must NEVER read or reuse a legacy shared-cover cache.
   const old=await root.caches.open(LEGACY);
   response=await old.match(cacheUrl(key));
  }
  return response?await response.blob():null;
 }
 async function putCache(uid,key,blob){
  const cache=await root.caches.open(cacheName(uid));
  await cache.put(cacheUrl(key),new Response(blob,{headers:{'Content-Type':await mimeFromBlob(blob)}}));
 }
 function remoteUrl({uid,key,cfg}){
  return String(cfg.url).replace(/\/+$/,'')+'/storage/v1/object/authenticated/'+BUCKET+'/'+encodeURIComponent(uid)+'/'+encodeURIComponent(key);
 }
 function uploadUrl({uid,key,cfg}){
  return String(cfg.url).replace(/\/+$/,'')+'/storage/v1/object/'+BUCKET+'/'+encodeURIComponent(uid)+'/'+encodeURIComponent(key);
 }
 function headers({session,cfg}){return {apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token}}
 async function getRemote({uid,key,session,cfg,fetcher=fetch}){
  const response=await fetcher(remoteUrl({uid,key,cfg}),{method:'GET',headers:headers({session,cfg}),cache:'no-store'});
  if(response.status===404)return null;
  check(response.ok,'No se pudo recuperar portada privada HTTP '+response.status);
  return response.blob();
 }
 async function upload({record,uid,session,cfg,fetcher=fetch}){
  const key=validate({record,uid,session,cfg});
  // Require the authenticated user's own local comic; prevents a shared
  // legacy-cache file being uploaded under a different account.
  check(typeof getStore==='function','La base local no está preparada');
  const owned=await getStore('comics',record.id);
  check(owned?.id===record.id&&owned?.coverKey===key,'Portada no asociada a un cómic de esta cuenta');
  const local=await fromCache(uid,key,{legacyFallback:key===record.id});
  check(local,'La portada original no está disponible en este dispositivo');
  const localProof=await integrity(local);
  if(record.coverSha256)check(localProof.sha256===record.coverSha256,'La imagen local no coincide con su huella');
  let remote=await getRemote({uid,key,session,cfg,fetcher});
  if(!remote){
   const result=await fetcher(uploadUrl({uid,key,cfg}),{
    method:'POST',
    headers:{...headers({session,cfg}),'Content-Type':localProof.mime,'x-upsert':'false'},
    body:local,cache:'no-store'
   });
   // Another device may have raced us to this filename: verify it byte-for-byte.
   check(result.ok||result.status===409,'Falló el envío de la portada privada HTTP '+result.status);
   remote=await getRemote({uid,key,session,cfg,fetcher});
   check(remote,'El archivo enviado no puede recuperarse de Storage');
  }
  const proof=await integrity(remote);
  check(proof.sha256===localProof.sha256,'Conflicto: Storage contiene otra portada con el mismo ID');
  await putCache(uid,key,local);
  return {sha256:proof.sha256,verified:true,uploaded:true};
 }
 async function download({record,uid,session,cfg,fetcher=fetch}){
  const key=validate({record,uid,session,cfg});
  const remote=await getRemote({uid,key,session,cfg,fetcher});
  check(remote,'La portada privada no está almacenada en Supabase');
  const proof=await integrity(remote);
  if(record.coverSha256)check(proof.sha256===record.coverSha256,'La portada cloud no coincide con la huella guardada');
  const local=await fromCache(uid,key,{legacyFallback:false});
  if(local){
   const existing=await integrity(local);
   check(existing.sha256===proof.sha256,'Conflicto de portada entre dispositivo y nube');
  }else await putCache(uid,key,remote);
  return {sha256:proof.sha256,verified:true,downloaded:!local};
 }

 // Convert an explicitly SAVED HTTPS cover link into an owned binary object.
 // Never scan legacy collections or bulk-fetch external sites automatically.
 // The caller atomically checks its outbox revision before changing the comic.
 async function prepareLinked({record,uid,session,cfg}){
  check(!record?.coverKey,'La portada ya dispone de referencia privada');
  const link=String(record?.coverUrl||'').trim();
  check(/^https:\/\//i.test(link),'Solo se admiten portadas enlazadas mediante HTTPS');
  const id=String(record?.id||'');
  check(/^[A-Za-z0-9_.:-]{1,180}$/.test(id),'Identificador de ficha no válido');
  check(session?.user?.id===uid&&session.access_token,'Identidad de portada no verificada');
  check(typeof root.CoverVault?.fetchAndCompress==='function','El recuperador de imágenes no está disponible');
  // This is a browser CORS download, never a blind link transfer. If the
  // image host forbids CORS or gives an invalid image, no cloud data is changed.
  const blob=await root.CoverVault.fetchAndCompress(link);
  const proof=await integrity(blob);
  const safeId=id.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,145);
  const key=safeId+'-'+proof.sha256.slice(0,20);
  check(key.length<=180,'Nombre de portada inválido');
  // Avoid creating a reference to bytes until the local cached copy exists.
  await putCache(uid,key,blob);
  return {...record,coverKey:key,coverSha256:proof.sha256,
    coverSourceUrl:link,coverSyncPending:true};
 }

 const api={cacheName,cacheUrl,mimeFromBlob,integrity,fromCache,putCache,remoteUrl,uploadUrl,getRemote,upload,download,prepareLinked};
 root.MCAutoCoversV4=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);