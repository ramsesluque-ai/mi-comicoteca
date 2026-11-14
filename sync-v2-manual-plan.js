'use strict';
/* MI COMICTECA Sync V2: genuine authenticated, keyset, two-way comparison.
 * READ-ONLY BY DESIGN. Never infer a deletion from a missing record.
 * Never write to IndexedDB or Supabase. No automatic reconciliation without
 * a saved baseline, verified backup, conflict handling and two-device tests.
 */
(function(root){
 function assert(condition,message){if(!condition)throw Error(message)}
 function canonical(value){
   function rec(v){
     if(v===null||typeof v!=='object')return v;
     if(v instanceof Date)return v.toISOString();
     if(typeof Blob!=='undefined'&&v instanceof Blob)throw Error('Portada binaria local: requiere respaldo independiente');
     if(Array.isArray(v))return v.map(rec);
     const out={};for(const k of Object.keys(v).sort()){if(v[k]!==undefined&&typeof v[k]!=='function')out[k]=rec(v[k])}return out;
   }
   return JSON.stringify(rec(value));
 }
 function localIndex(rows){
   assert(Array.isArray(rows),'La lectura del catálogo local no es válida');
   const map=new Map();
   for(const r of rows){
     const id=String(r?.id??'').trim();
     assert(id&&id!=='undefined'&&id!=='null','Existe una ficha local sin identificador');
     assert(!map.has(id),'Hay identificadores locales duplicados; no se puede sincronizar');
     map.set(id,canonical(r));
   }
   return map;
 }
 async function compare({session,cfg,localRows,fetcher=fetch,onProgress=()=>{},signal,pageSize=250,maxPages=1000}){
   assert(session?.access_token&&session?.user?.id,'Inicia sesión para comparar tu catálogo');
   assert(cfg?.url&&cfg?.publishableKey,'Falta la configuración segura de Supabase');
   assert(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=500,'Tamaño de página inválido');
   assert(Number.isInteger(maxPages)&&maxPages>=1,'Límite de páginas inválido');
   const uid=String(session.user.id),base=String(cfg.url).replace(/\/+$/,'');
   const headers={apikey:cfg.publishableKey,Authorization:'Bearer '+session.access_token};
   const local=localIndex(localRows),matched=new Set(),seen=new Set();
   // Never trust a user ID taken only from browser storage.
   const who=await fetcher(base+'/auth/v1/user',{method:'GET',headers,cache:'no-store',signal});
   if(!who.ok)throw Error('Tu sesión no se pudo verificar (HTTP '+who.status+'). Inicia sesión de nuevo');
   const verified=await who.json();
   assert(String(verified?.id||'')===uid,'La identidad de sesión no coincide; operación cancelada');
   const stats={local:local.size,cloud:0,equal:0,different:0,onlyLocal:0,onlyCloud:0,tombstones:0,otherKinds:0,pages:0,verifiedUser:true,readOnly:true};
   let last=null,complete=false;
   for(let page=0;page<maxPages;page++){
     if(signal?.aborted)throw Error('Comparación cancelada');
     const query='?select=user_id,local_id,metadata&user_id=eq.'+encodeURIComponent(uid)+'&order=local_id.asc&limit='+pageSize+(last===null?'':'&local_id=gt.'+encodeURIComponent(last));
     const r=await fetcher(base+'/rest/v1/user_comics'+query,{method:'GET',headers,cache:'no-store',signal});
     if(!r.ok)throw Error('No se pudo consultar Supabase (HTTP '+r.status+')');
     const batch=await r.json();
     assert(Array.isArray(batch)&&batch.length<=pageSize,'La nube ha devuelto una página inválida');
     for(const row of batch){
       assert(row&&String(row.user_id)===uid,'La nube ha devuelto datos de otro usuario');
       const key=row.local_id;
       assert(typeof key==='string'&&key.trim(),'La nube contiene una fila sin local_id');
       assert((last===null||key>last)&&!seen.has(key),'La nube contiene una clave duplicada o una página fuera de orden');
       seen.add(key);last=key;
       if(!key.startsWith('comics:')){stats.otherKinds++;continue}
       const m=row.metadata||{},id=key.slice('comics:'.length);
       assert(id&&m.kind==='comics','La clave de una ficha no coincide con su tipo');
       if(m.deleted===true){
         // A cloud tombstone is NOT an upload candidate. Count its local ID as
         // seen, but never interpret its absence as permission to delete.
         stats.tombstones++;
         if(local.has(id))matched.add(id);
         continue;
       }
       assert(m.record&&String(m.record.id)===id,'La nube contiene una ficha con identidad inconsistente');
       stats.cloud++;
       if(local.has(id)){
         matched.add(id);
         if(local.get(id)===canonical(m.record))stats.equal++;
         else stats.different++;
       }else stats.onlyCloud++;
     }
     stats.pages++;
     onProgress({...stats,scanned:seen.size});
     if(batch.length<pageSize){complete=true;break}
   }
   assert(complete,'La lectura de la nube no ha terminado: límite de paginación');
   stats.onlyLocal=local.size-matched.size;
   stats.complete=true;
   // Differences are candidates to REVIEW, not permission to write/delete.
   stats.safeToWrite=false;
   return stats;
 }
 const api={canonical,localIndex,compare};
 root.MCSyncV2ReadPlan=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
