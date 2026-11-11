'use strict';
/* MI COMICTECA — Sync V2 reconciliation primitives.
 * Staged only: NOT loaded by index.html until integration tests pass.
 * Never overwrite nonempty bibliographic/cover fields with empty cloud values.
 */
(function(root){
 const KEEP=['title','universe','coverKey','coverUrl','coverSourceUrl','coverUrls','catalogHeader','publisher','series','volume','stage','startYear','issueNr','issue','authors','synopsis','group'];
 const empty=x=>x===null||x===undefined||x===''||(Array.isArray(x)&&!x.length)||(typeof x==='object'&&!Array.isArray(x)&&!Object.keys(x).length);
 const normalized=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 function identity(r){
   const fields=[r.publisher,r.catalogHeader||r.series,r.volume,r.stage,r.startYear,r.issueNr??r.issue];
   if(!fields[0]||!fields[1]||!fields[5])return null;
   return fields.map(normalized).join('|');
 }
 function merge(local,remote){
   if(!local)return {...remote};
   if(!remote)return {...local};
   const result={...local,...remote};
   for(const k of KEEP)if(empty(remote[k])&&!empty(local[k]))result[k]=local[k];
   // Keep the original local identity. Never turn an update into a new record.
   result.id=local.id;
   return result;
 }
 function reconcile(localRows,remoteRows){
   const localById=new Map(localRows.map(r=>[String(r.id),r]));
   const byIdentity=new Map();
   for(const r of localRows){const key=identity(r);if(key){const a=byIdentity.get(key)||[];a.push(r);byIdentity.set(key,a)}}
   const downloads=[],updates=[],conflicts=[];
   for(const r of remoteRows){
     if(r.deleted)continue;
     const local=localById.get(String(r.id));
     if(local){
       const merged=merge(local,r);
       if(JSON.stringify(merged)!==JSON.stringify(local))updates.push(merged);
       continue;
     }
     const key=identity(r),matches=key?byIdentity.get(key)||[]:[];
     if(matches.length){conflicts.push({reason:'different-id-same-issue',remote:r,localIds:matches.map(x=>x.id)});continue}
     downloads.push(r);
   }
   return {downloads,updates,conflicts};
 }
 // Three-way, per-field plan: no blind last-writer-wins for concurrent edits.
 // base is the last acknowledged snapshot for this record; absent base is unsafe.
 function threeWay(base,local,remote){
   if(!base||!local||!remote||String(base.id)!==String(local.id)||String(base.id)!==String(remote.id))
     return {status:'conflict',reason:'missing-or-mismatched-baseline'};
   if(local.deleted||remote.deleted){
     if(local.deleted&&remote.deleted)return {status:'unchanged',record:{...remote,deleted:true}};
     const deleted=local.deleted?local:remote,other=local.deleted?remote:local;
     const changed=Object.keys(other).some(k=>k!=='deleted'&&JSON.stringify(other[k])!==JSON.stringify(base[k]));
     return changed?{status:'conflict',reason:'delete-versus-edit'}:{status:'merged',record:{...deleted,deleted:true}};
   }
   const keys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]);
   const record={...base},conflicts=[];
   for(const key of keys){
     if(key==='id'){record.id=base.id;continue}
     const a=JSON.stringify(base[key]),l=JSON.stringify(local[key]),r=JSON.stringify(remote[key]);
     if(l===r){if(l===undefined)delete record[key];else record[key]=local[key]}
     else if(l===a){if(r===undefined)delete record[key];else record[key]=remote[key]}
     else if(r===a){if(l===undefined)delete record[key];else record[key]=local[key]}
     else conflicts.push(key);
   }
   if(conflicts.length)return {status:'conflict',reason:'concurrent-field-edits',fields:conflicts};
   return {status:'merged',record};
 }
 root.MCReconcileV2={identity,merge,reconcile,threeWay};
})(typeof window!=='undefined'?window:globalThis);
