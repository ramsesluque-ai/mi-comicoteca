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
   if(Array.isArray(value))return value.map(stable);
   if(value&&typeof value==='object'){
     const out={};for(const key of Object.keys(value).sort()){
       if(value[key]===undefined||typeof value[key]==='function')throw Error('Campo no serializable');
       out[key]=stable(value[key]);
     }
     return out;
   }
   if(typeof value==='number'&&!Number.isFinite(value))throw Error('Número no finito');
   return value;
 }
 function rowsValid(rows){
   if(!Array.isArray(rows))throw Error('Catálogo base inválido');
   const ids=new Set();
   for(const r of rows){
     if(!r||typeof r!=='object'||Array.isArray(r)||r.id===null||r.id===undefined)throw Error('Ficha sin ID');
     const id=String(r.id).trim();
     if(!id||ids.has(id))throw Error('ID ausente o duplicado en baseline');
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
