'use strict';
/* V2 immutable baseline checkpoint codec. Staged only; no browser writes.
 * A checkpoint must be verified against its SHA-256 and user identity before
 * any three-way merge can be planned. A missing checkpoint is NOT empty base.
 */
(function(root){
 const enc=new TextEncoder();
 const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 const uidOK=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
 function stable(value){
   // Fail closed: JSON.stringify silently drops undefined, sparse array slots,
   // symbols and custom objects. Such a digest must never authorize a merge.
   const ancestors=new Set();
   function visit(v){
     if(v===undefined||typeof v==='function'||typeof v==='symbol'||typeof v==='bigint')
       throw Error('Campo de baseline no serializable');
     if(typeof v==='number'&&!Number.isFinite(v))throw Error('Número no finito');
     if(v===null||typeof v!=='object')return v;
     if(v instanceof Date){
       if(!Number.isFinite(v.getTime()))throw Error('Fecha inválida en baseline');
       return v.toISOString();
     }
     if(typeof Blob!=='undefined'&&v instanceof Blob)
       throw Error('Portada binaria requiere respaldo independiente');
     if(ancestors.has(v))throw Error('Referencia circular en baseline');
     if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null&&!Array.isArray(v))
       throw Error('Objeto de baseline no serializable');
     ancestors.add(v);
     try{
       if(Array.isArray(v)){
         if(Array.from({length:v.length},(_,i)=>Object.hasOwn(v,i)).some(present=>!present))
           throw Error('Array incompleto en baseline');
         return v.map(visit);
       }
       const out={};
       for(const key of Object.keys(v).sort())
         Object.defineProperty(out,key,{value:visit(v[key]),enumerable:true,writable:true,configurable:true});
       return out;
     }finally{ancestors.delete(v)}
   }
   return visit(value);
 }
 function rowsValid(rows){
   if(!Array.isArray(rows))throw Error('Catálogo base inválido');
   const ids=new Set();
   for(const r of rows){
     if(!r||typeof r!=='object'||Array.isArray(r)||r.id===null||r.id===undefined)throw Error('Ficha sin ID');
     // IDs are immutable identity keys, not display labels: whitespace or
     // object coercion could make two devices address different cloud rows.
     const raw=r.id;
     const valid=(typeof raw==='string'&&raw.length>0&&raw===raw.trim())||
       (typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0);
     if(!valid)throw Error('ID estable inválido en baseline');
     const id=String(raw);
     if(ids.has(id))throw Error('ID ausente o duplicado en baseline');
     ids.add(id);
   }
   return rows;
 }
 function codec(cryptoImpl=root.crypto){
   if(!cryptoImpl?.subtle?.digest)throw Error('SHA-256 obligatorio');
   return async value=>hex(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',enc.encode(JSON.stringify(stable(value))))));
 }
 async function digestRows(rows,{cryptoImpl=root.crypto}={}){rowsValid(rows);return codec(cryptoImpl)(rows)}
 async function create({uid,rows,remoteSnapshotHash,cryptoImpl=root.crypto}){
   if(!uidOK(uid))throw Error('Usuario inválido');
   rowsValid(rows);
   if(!/^[a-f0-9]{64}$/i.test(remoteSnapshotHash||''))throw Error('Huella remota obligatoria');
   const actualHash=await digestRows(rows,{cryptoImpl});
   if(actualHash!==remoteSnapshotHash.toLowerCase())throw Error('La huella remota no corresponde a las fichas del baseline');
   const canonicalRows=stable(rows);
   const payload={format:'mi-comicoteca-sync-v2-baseline-v1',uid:uid.toLowerCase(),remoteSnapshotHash:remoteSnapshotHash.toLowerCase(),rows:canonicalRows};
   const sha256=await codec(cryptoImpl)(payload);
   return {payload,sha256};
 }
 async function verify({checkpoint,uid,cryptoImpl=root.crypto}){
   if(!uidOK(uid))throw Error('Usuario inválido');
   const {payload,sha256}=checkpoint||{};
   if(payload?.format!=='mi-comicoteca-sync-v2-baseline-v1'||payload.uid!==uid.toLowerCase())throw Error('Baseline ausente o de otro usuario');
   if(!/^[a-f0-9]{64}$/i.test(payload.remoteSnapshotHash||'')||!/^[a-f0-9]{64}$/i.test(sha256||''))throw Error('Huella de baseline inválida');
   rowsValid(payload.rows);
   const computed=await codec(cryptoImpl)(payload);
   if(computed!==sha256.toLowerCase())throw Error('Baseline alterado: SHA-256 no coincide');
   const rowsHash=await digestRows(payload.rows,{cryptoImpl});
   if(rowsHash!==payload.remoteSnapshotHash.toLowerCase())throw Error('Baseline inconsistente: la huella remota no corresponde a sus fichas');
   return {rows:payload.rows,remoteSnapshotHash:payload.remoteSnapshotHash,sha256:computed};
 }
 async function plan({checkpoint,uid,localRows,remoteRows,remoteSnapshotHash,reconciler=root.MCReconcileV2,cryptoImpl=root.crypto}){
   const base=await verify({checkpoint,uid,cryptoImpl});
   rowsValid(localRows);rowsValid(remoteRows);
   const actualRemoteHash=await digestRows(remoteRows,{cryptoImpl});
   if(actualRemoteHash!==remoteSnapshotHash)throw Error('Snapshot remoto no coincide con la huella suministrada: bloquear escritura');
   if(!reconciler?.planWithBaseline)throw Error('Motor de reconciliación no disponible');
   const result=reconciler.planWithBaseline(base.rows,localRows,remoteRows);
   return {...result,baselineVerified:true,writeAuthorized:false};
 }
 const api={create,verify,plan,rowsValid,digestRows};
 root.MCSyncV2Checkpoint=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
