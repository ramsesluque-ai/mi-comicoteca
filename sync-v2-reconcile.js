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
 root.MCReconcileV2={identity,merge,reconcile};
})(typeof window!=='undefined'?window:globalThis);
