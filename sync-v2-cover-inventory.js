'use strict';
/* MI COMICTECA V2 cover inventory: compares local CacheStorage with the
 * per-user Supabase Storage objects. Read-only: POST /object/list is a
 * Storage listing endpoint; it does not upload or mutate any object.
 * Results are advisory and NEVER authorize destructive synchronization.
 */
(function(root){
 const BUCKET='user-covers',CACHE='mi-comicoteca-cover-vault-v1';
 function check(cond,message){if(!cond)throw Error(message)}
 function coverKey(request){
   const url=new URL(typeof request==='string'?request:request?.url||'');
   if(url.origin!=='https://mi-comicoteca.local'||!url.pathname.startsWith('/cover/'))return null;
   const key=decodeURIComponent(url.pathname.slice('/cover/'.length));
   check(key&&key!=='..'&&!key.includes('/')&&!key.includes('\\'),'Clave de portada local inválida');
   return key;
 }
 async function localKeys({cacheStorage=root.caches}={}){
   check(cacheStorage?.open,'No está disponible CacheStorage para comprobar las portadas');
   const cache=await cacheStorage.open(CACHE),requests=await cache.keys(),keys=new Set();
   for(const request of requests){const key=coverKey(request);if(key)keys.add(key)}
   return keys;
 }
 async function remoteKeys({session,cfg,fetcher=root.fetch,limit=250,maxPages=1000,onProgress=()=>{},signal}){
   const uid=String(session?.user?.id||''),token=session?.access_token;
   check(uid&&token,'Es necesario iniciar sesión para consultar las portadas privadas');
   check(cfg?.url&&cfg.publishableKey,'Configuración de Supabase no disponible');
   check(Number.isInteger(limit)&&limit>0&&limit<=1000,'Tamaño de página inválido');
   const base=String(cfg.url).replace(/\/+$/,''),prefix=uid+'/',keys=new Set();
   let complete=false,offset=0,pages=0;
   for(let page=0;page<maxPages;page++){
     if(signal?.aborted)throw Error('Lectura de portadas cancelada');
     const r=await fetcher(base+'/storage/v1/object/list/'+BUCKET,{
       method:'POST',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},
       body:JSON.stringify({prefix,limit,offset,sortBy:{column:'name',order:'asc'}}),
       cache:'no-store',signal
     });
     if(!r.ok)throw Error('Almacenamiento de portadas HTTP '+r.status);
     const rows=await r.json();
     check(Array.isArray(rows)&&rows.length<=limit,'La lista de portadas remotas no es válida');
     for(const x of rows){
       check(typeof x?.name==='string'&&x.name.trim()&&!x.name.includes('/')&&!x.name.includes('\\'),'Nombre de portada remota inválido');
       check(!keys.has(x.name),'Portada remota duplicada durante la lectura');
       keys.add(x.name);
     }
     pages++;
     onProgress({remote:keys.size,pages});
     if(rows.length<limit){complete=true;break}
     offset+=rows.length;
   }
   check(complete,'El inventario remoto de portadas no está completo');
   return keys;
 }
 async function compare(opts={}){
   const [local,remote]=await Promise.all([localKeys(opts),remoteKeys(opts)]);
   const onlyLocal=[...local].filter(x=>!remote.has(x)),onlyRemote=[...remote].filter(x=>!local.has(x));
   return {
     local:local.size,remote:remote.size,matched:local.size-onlyLocal.length,
     onlyLocal:onlyLocal.length,onlyRemote:onlyRemote.length,
     onlyLocalSample:onlyLocal.slice(0,5),onlyRemoteSample:onlyRemote.slice(0,5),
     complete:true,readOnly:true,safeToWrite:false,
     note:'Un nombre de archivo coincidente no garantiza integridad: hay que validar SHA-256 binario antes de transferir.'
   };
 }
 // User-requested byte audit. READ ONLY: reads the shared legacy cache and private
 // Storage, never modifies either. Names alone are not evidence of matching covers.
 async function compareBytes({session,cfg,cacheStorage=root.caches,fetcher=root.fetch,integrity=root.MCSyncV2CoverIntegrity,maxCheck=30,onProgress=()=>{},signal}={}){
   const uid=String(session?.user?.id||'');
   check(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(uid)&&session?.access_token,'Sesión privada inválida');
   check(cfg?.url&&cfg?.publishableKey,'Configuración privada no disponible');
   check(cacheStorage?.open&&integrity?.verifyPair,'Verificador de portadas no disponible');
   check(Number.isInteger(maxCheck)&&maxCheck>0&&maxCheck<=50,'Límite de comprobación inválido');
   const base=String(cfg.url).replace(/\/+$/,'');
   const headers={apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token};
   const who=await fetcher(base+'/auth/v1/user',{method:'GET',headers,cache:'no-store',signal});
   if(!who.ok)throw Error('Sesión no verificada (HTTP '+who.status+')');
   const profile=await who.json();
   check(profile?.id===uid,'La identidad autenticada no coincide');
   const [local,remote]=await Promise.all([localKeys({cacheStorage}),remoteKeys({session,cfg,fetcher,signal})]);
   const names=[...local].filter(k=>remote.has(k)).sort();
   const cache=await cacheStorage.open(CACHE);
   const stats={totalMatched:names.length,checked:0,identical:0,different:0,remaining:names.length,complete:false,readOnly:true,safeToWrite:false};
   for(const key of names.slice(0,maxCheck)){
     if(signal?.aborted)throw Error('Comprobación cancelada');
     check(/^[a-zA-Z0-9_.-]{1,180}$/.test(key)&&key!=='.'&&key!=='..','Clave privada de portada inválida');
     const item=await cache.match('https://mi-comicoteca.local/cover/'+encodeURIComponent(key));
     check(item,'Portada local desaparecida durante la comprobación');
     const localBlob=await item.blob();
     const url=base+'/storage/v1/object/'+BUCKET+'/'+encodeURIComponent(uid)+'/'+encodeURIComponent(key);
     const result=await fetcher(url,{method:'GET',headers,cache:'no-store',signal});
     if(!result.ok)throw Error('No se pudo verificar portada privada ('+result.status+')');
     const remoteBlob=await result.blob();
     check(['image/jpeg','image/png','image/webp'].includes(localBlob.type)&&['image/jpeg','image/png','image/webp'].includes(remoteBlob.type),'Imagen privada no válida');
     const hashes=await integrity.verifyPair(localBlob,remoteBlob);
     if(hashes.equal)stats.identical++;else stats.different++;
     stats.checked++;stats.remaining=names.length-stats.checked;
     onProgress({...stats});
   }
   stats.complete=stats.remaining===0;
   return stats;
 }
 const api={coverKey,localKeys,remoteKeys,compare,compareBytes};
 root.MCSyncV2CoverInventory=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
