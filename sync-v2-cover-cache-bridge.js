'use strict';
/* Sync V2 private CoverVault bridge: staged until authenticated E2E/RLS is approved.
 * This module is NOT loaded by the production button. The source is a per-user
 * CacheStorage namespace, never the legacy shared CoverVault cache.
 * No catalogue/metadata writes, deletions, upserts or automatic sync.
 */
(function(root){
 const CACHE_PREFIX='mi-comicoteca-private-covers-v2-';
 const URL_PREFIX='https://mi-comicoteca.local/cover/';
 const safeKey=k=>typeof k==='string'&&/^[a-zA-Z0-9_.-]{1,180}$/.test(k)&&k!=='.'&&k!=='..';
 const validHash=h=>typeof h==='string'&&/^[a-f0-9]{64}$/i.test(h);
 function identity(session,cfg,key){
   const uid=session?.user?.id;
   if(!uid||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(uid)||!session?.access_token)
     throw Error('Sesión privada inválida');
   if(!cfg?.url||!/^https:\/\//.test(cfg.url)||!cfg.publishableKey)
     throw Error('Configuración privada inválida');
   if(!safeKey(key))throw Error('Clave privada inválida');
   return uid;
 }
 function cacheName(uid){if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(uid||''))throw Error('Usuario inválido');return CACHE_PREFIX+uid.toLowerCase()}
 function cacheUrl(key){if(!safeKey(key))throw Error('Clave privada inválida');return URL_PREFIX+encodeURIComponent(key)}
 async function verifiedOwner({session,cfg,key,fetchImpl=root.fetch}){
   const uid=identity(session,cfg,key);
   if(typeof fetchImpl!=='function')throw Error('Cliente de autenticación no disponible');
   const r=await fetchImpl(cfg.url.replace(/\/+$/,'')+'/auth/v1/user',{method:'GET',cache:'no-store',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token}});
   if(!r.ok)throw Error('La sesión ha caducado o no tiene acceso (HTTP '+r.status+')');
   const owner=await r.json();
   if(owner?.id!==uid)throw Error('Identidad autenticada distinta: operación bloqueada');
   return uid;
 }
 function dependencies({cacheStorage=root.caches,integrity=root.MCSyncV2CoverIntegrity,transport=root.MCSyncV2CoverTransport}){
   if(!cacheStorage?.open||!integrity?.sha256||!integrity?.verifyExpected||!integrity?.verifyPair||!transport?.copyIfAbsent||!transport?.readVerified)
     throw Error('Dependencias privadas de sincronización no disponibles');
   return {cacheStorage,integrity,transport};
 }
 async function local({session,cfg,key,cacheStorage,integrity,transport,fetchImpl}){
   const uid=await verifiedOwner({session,cfg,key,fetchImpl});
   const deps=dependencies({cacheStorage,integrity,transport});
   const cache=await deps.cacheStorage.open(cacheName(uid));
   const item=await cache.match(cacheUrl(key));
   return item?item.blob():null;
 }
 async function installIfAbsent({session,cfg,key,blob,expectedSha256,cacheStorage,integrity,transport,fetchImpl}){
   const uid=await verifiedOwner({session,cfg,key,fetchImpl});
   const deps=dependencies({cacheStorage,integrity,transport});
   if(!validHash(expectedSha256))throw Error('SHA-256 esperado obligatorio');
   if(!(blob instanceof Blob)||!blob.size||blob.size>5*1024*1024||!['image/webp','image/jpeg','image/png'].includes(blob.type))
     throw Error('Imagen privada no válida');
   const v=await deps.integrity.verifyExpected(blob,expectedSha256);
   if(!v.equal)throw Error('SHA-256 de imagen privada no coincide');
   const cache=await deps.cacheStorage.open(cacheName(uid)),url=cacheUrl(key);
   const old=await cache.match(url);
   if(old){
     const previous=await old.blob(),result=await deps.integrity.verifyPair(blob,previous);
     if(!result.equal)throw Error('Conflicto de portada local: no sobrescribir');
     return {status:'already-identical',sha256:v.actualSha256};
   }
   await cache.put(url,new Response(blob,{headers:{'Content-Type':blob.type}}));
   const installed=await cache.match(url);
   if(!installed)throw Error('No se pudo verificar portada guardada en caché privada');
   const check=await deps.integrity.verifyExpected(await installed.blob(),expectedSha256);
   if(!check.equal)throw Error('SHA-256 incorrecto tras guardar portada privada');
   return {status:'downloaded-and-verified',sha256:check.actualSha256};
 }
 async function upload({session,cfg,key,expectedSha256,cacheStorage,integrity,transport,fetchImpl}){
   const uid=await verifiedOwner({session,cfg,key,fetchImpl});
   const deps=dependencies({cacheStorage,integrity,transport});
   if(!validHash(expectedSha256))throw Error('SHA-256 esperado obligatorio');
   const cache=await deps.cacheStorage.open(cacheName(uid));
   const item=await cache.match(cacheUrl(key));
   if(!item)throw Error('La portada privada no está en la caché de este usuario');
   const blob=await item.blob();
   const check=await deps.integrity.verifyExpected(blob,expectedSha256);
   if(!check.equal)throw Error('SHA-256 local distinto del manifiesto: subida bloqueada');
   return deps.transport.copyIfAbsent({session,cfg,key,blob,integrity:deps.integrity,fetchImpl});
 }
 async function download({session,cfg,key,expectedSha256,cacheStorage,integrity,transport,fetchImpl}){
   await verifiedOwner({session,cfg,key,fetchImpl});
   const deps=dependencies({cacheStorage,integrity,transport});
   if(!validHash(expectedSha256))throw Error('SHA-256 esperado obligatorio');
   const remote=await deps.transport.readVerified({session,cfg,key,expectedSha256,integrity:deps.integrity,fetchImpl});
   if(remote.status==='missing')return {status:'missing'};
   return installIfAbsent({session,cfg,key,blob:remote.blob,expectedSha256,cacheStorage:deps.cacheStorage,integrity:deps.integrity,transport:deps.transport,fetchImpl});
 }
 const api={cacheName,cacheUrl,verifiedOwner,local,installIfAbsent,upload,download};
 root.MCSyncV2PrivateCoverBridge=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
