'use strict';
/* Read-only inventory bridge for the legacy CoverVault cache. It never copies
 * an image into a user namespace: legacy cache entries have no ownership
 * metadata and must not be attributed to a logged-in user automatically.
 * This module is staged, not loaded by the production sync button.
 */
(function(root){
 const LEGACY='mi-comicoteca-cover-vault-v1';
 const URL='https://mi-comicoteca.local/cover/';
 const safeKey=key=>typeof key==='string'&&/^[A-Za-z0-9_.-]{1,180}$/.test(key)&&key!=='.'&&key!=='..';
 async function inspect({cacheStorage=root.caches,keys=[],integrity=root.MCSyncV2CoverIntegrity}={}){
   if(!cacheStorage?.open||!integrity?.sha256)throw Error('Auditoría SHA-256 no disponible');
   if(!Array.isArray(keys)||keys.length>1000||keys.some(k=>!safeKey(k))||new Set(keys).size!==keys.length)
     throw Error('Manifiesto de claves inválido');
   const cache=await cacheStorage.open(LEGACY);
   const found=[],missing=[];
   for(const key of keys){
     const response=await cache.match(URL+encodeURIComponent(key));
     if(!response){missing.push(key);continue}
     const blob=await response.blob();
     if(!blob.size||blob.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(blob.type))
       throw Error('Portada antigua inválida: '+key);
     found.push({key,sha256:await integrity.sha256(blob),bytes:blob.size,type:blob.type});
   }
   return {found,missing,readOnly:true,ownershipVerified:false,safeToTransfer:false};
 }
 const api={inspect};
 root.MCSyncV2LegacyCoverAudit=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
