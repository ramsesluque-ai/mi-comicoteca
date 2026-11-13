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
 function assertCover(blob){
   if(!(blob instanceof Blob)||!blob.size||blob.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(blob.type))throw Error('Portada inválida: se requiere JPG, PNG o WebP no vacío de hasta 5 MB');
 }
 function path(uid,key){return '/storage/v1/object/user-covers/'+encodeURIComponent(uid)+'/'+encodeURIComponent(key)}
 async function read({session,cfg,key,fetchImpl=root.fetch,integrity=root.MCSyncV2CoverIntegrity}){
   const uid=validate({session,cfg,key,integrity});
   const res=await fetchImpl(cfg.url+path(uid,key),{method:'GET',cache:'no-store',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token}});
   if(res.status===404)return null;
   if(!res.ok)throw Error('No se pudo recuperar portada ('+res.status+')');
   const blob=await res.blob();
   assertCover(blob);
   await integrity.sha256(blob);
   return blob;
 }
 async function readVerified({expectedSha256,...options}){
   // Never install a downloaded cover in CoverVault until its expected digest matches.
   if(typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/i.test(expectedSha256))
     throw Error('SHA-256 esperado obligatorio para restaurar portada');
   const blob=await read(options);
   if(!blob)return {status:'missing',blob:null};
   const integrity=options.integrity||root.MCSyncV2CoverIntegrity;
   if(!integrity?.verifyExpected)throw Error('Verificador de huella esperado no disponible');
   const result=await integrity.verifyExpected(blob,expectedSha256);
   if(!result.equal)throw Error('SHA-256 de portada remota no coincide; no instalar');
   return {status:'verified',blob,sha256:result.actualSha256};
 }
 async function copyIfAbsent({session,cfg,key,blob,fetchImpl=root.fetch,integrity=root.MCSyncV2CoverIntegrity}){
   const uid=validate({session,cfg,key,integrity});
   assertCover(blob);
   const expected=await integrity.sha256(blob);
   const existing=await read({session,cfg,key,fetchImpl,integrity});
   if(existing){
     const comparison=await integrity.verifyPair(blob,existing);
     if(!comparison.equal)throw Error('Conflicto de portada remota: contenido diferente; no se sobrescribe');
     return {status:'already-identical',sha256:expected};
   }
   let res;
   try{
     res=await fetchImpl(cfg.url+path(uid,key),{method:'POST',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token,'Content-Type':blob.type||'image/webp','x-upsert':'false'},body:blob});
   }catch(error){
     // Network failures can happen after the server commits. Re-read instead of retrying POST.
     let uncertain;
     try{uncertain=await read({session,cfg,key,fetchImpl,integrity})}
     catch(_readError){throw Error('Subida incierta: GET de verificación falló; no reintentar automáticamente')}
     if(!uncertain)throw Error('Subida incierta: portada ausente tras GET; reintento manual seguro');
     const check=await integrity.verifyPair(blob,uncertain);
     if(!check.equal)throw Error('Conflicto tras error de red: SHA-256 distinto; no sobrescribir');
     return {status:'uploaded-network-error-verified',sha256:expected};
   }
   // Concurrent creation can yield 400/409; re-read and verify, never blindly accept.
   if(!res.ok&&res.status!==400&&res.status!==409){
     // A timeout/5xx may occur AFTER Storage persisted the object. Never blindly retry POST.
     if(res.status>=500){
       let uncertain;
       try{uncertain=await read({session,cfg,key,fetchImpl,integrity})}
       catch(_readError){throw Error('Subida incierta ('+res.status+'): GET de verificación falló; no reintentar automáticamente')}
       if(uncertain){
         const check=await integrity.verifyPair(blob,uncertain);
         if(!check.equal)throw Error('Conflicto tras respuesta incierta: SHA-256 distinto; no sobrescribir');
         return {status:'uploaded-response-lost-verified',sha256:expected};
       }
       throw Error('Subida incierta ('+res.status+'): portada ausente tras GET; reintento manual seguro');
     }
     throw Error('Subida rechazada ('+res.status+')');
   }
   const stored=await read({session,cfg,key,fetchImpl,integrity});
   if(!stored)throw Error('No se pudo verificar la portada tras subida');
   const comparison=await integrity.verifyPair(blob,stored);
   if(!comparison.equal)throw Error('SHA-256 distinto tras subida; requiere intervención');
   return {status:res.ok?'uploaded-and-verified':'concurrent-identical',sha256:expected};
 }
 const api={read,readVerified,copyIfAbsent};
 root.MCSyncV2CoverTransport=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
