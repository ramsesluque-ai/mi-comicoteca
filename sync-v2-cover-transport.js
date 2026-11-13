'use strict';
/* V2 private cover transport. Staged only: never invoked automatically.
 * Caller must provide a verified user session and explicitly request a copy.
 * POST is create-only; an existing object is accepted ONLY after byte-for-byte SHA verification.
 * No local deletion, no upsert and no listing of other users' objects.
 */
(function(root){
 const safeKey=k=>typeof k==='string'&&/^[a-zA-Z0-9_.-]{1,180}$/.test(k)&&k!=='.'&&k!=='..';
 function validate({session,cfg,key,integrity}){
   const uid=session?.user?.id;
   if(!uid||!/^[0-9a-f-]{36}$/i.test(uid)||!session?.access_token)throw Error('Sesión autenticada inválida');
   if(!cfg?.url||!/^https:\/\//.test(cfg.url)||!cfg?.publishableKey)throw Error('Configuración cloud inválida');
   if(!safeKey(key))throw Error('Identificador de portada inválido');
   if(!integrity?.sha256||!integrity?.verifyPair)throw Error('Verificador SHA-256 no disponible');
   return uid;
 }
 function path(uid,key){return '/storage/v1/object/user-covers/'+encodeURIComponent(uid)+'/'+encodeURIComponent(key)}
 async function read({session,cfg,key,fetchImpl=root.fetch,integrity=root.MCSyncV2CoverIntegrity}){
   const uid=validate({session,cfg,key,integrity});
   const res=await fetchImpl(cfg.url+path(uid,key),{method:'GET',cache:'no-store',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token}});
   if(res.status===404)return null;
   if(!res.ok)throw Error('No se pudo recuperar portada ('+res.status+')');
   const blob=await res.blob();
   await integrity.sha256(blob);
   return blob;
 }
 async function copyIfAbsent({session,cfg,key,blob,fetchImpl=root.fetch,integrity=root.MCSyncV2CoverIntegrity}){
   const uid=validate({session,cfg,key,integrity});
   const expected=await integrity.sha256(blob);
   const existing=await read({session,cfg,key,fetchImpl,integrity});
   if(existing){
     const comparison=await integrity.verifyPair(blob,existing);
     if(!comparison.equal)throw Error('Conflicto de portada remota: contenido diferente; no se sobrescribe');
     return {status:'already-identical',sha256:expected};
   }
   const res=await fetchImpl(cfg.url+path(uid,key),{method:'POST',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token,'Content-Type':blob.type||'image/webp','x-upsert':'false'},body:blob});
   // Concurrent creation can yield 400/409; re-read and verify, never blindly accept.
   if(!res.ok&&res.status!==400&&res.status!==409)throw Error('Subida rechazada ('+res.status+')');
   const stored=await read({session,cfg,key,fetchImpl,integrity});
   if(!stored)throw Error('No se pudo verificar la portada tras subida');
   const comparison=await integrity.verifyPair(blob,stored);
   if(!comparison.equal)throw Error('SHA-256 distinto tras subida; requiere intervención');
   return {status:res.ok?'uploaded-and-verified':'concurrent-identical',sha256:expected};
 }
 const api={read,copyIfAbsent};
 root.MCSyncV2CoverTransport=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
