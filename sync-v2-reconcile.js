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
   // A previously acknowledged tombstone must never be silently resurrected.
   if(base.deleted && (!local.deleted || !remote.deleted))
     return {status:'conflict',reason:'tombstone-resurrection'};
   if(local.deleted||remote.deleted){
     // A deletion is only actionable when backed by an explicit, valid tombstone.
     // A bare `deleted: true` can be produced by malformed imports or partial pages.
     for(const candidate of [local,remote]){
       if(candidate.deleted && (typeof candidate.deletedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(candidate.deletedAt) || !Number.isFinite(Date.parse(candidate.deletedAt)) || new Date(candidate.deletedAt).toISOString().slice(0,19)!==candidate.deletedAt.slice(0,19)))
         return {status:'conflict',reason:'invalid-tombstone-timestamp'};
     }
     if(local.deleted&&remote.deleted){
       // Independently changed deletion timestamps are not equivalent acknowledgements.
       // Never choose a winner by last-write-wins: a stale device could erase audit history.
       if(local.deletedAt!==remote.deletedAt)
         return {status:'conflict',reason:'divergent-tombstone-timestamps'};
       return {status:'unchanged',record:{...remote,deleted:true}};
     }
     const deleted=local.deleted?local:remote,other=local.deleted?remote:local;
     const changed=new Set([...Object.keys(base),...Object.keys(other)]);
     changed.delete('deleted');
     changed.delete('deletedAt');
     const edited=[...changed].some(k=>JSON.stringify(other[k])!==JSON.stringify(base[k]));
     return edited?{status:'conflict',reason:'delete-versus-edit'}:{status:'merged',record:{...deleted,deleted:true}};
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
   // A remote or local empty cover field must never silently discard a saved cover.
   // Require explicit conflict resolution for clearing any protected cover metadata.
   const protectedCoverFields=['coverKey','coverUrl','coverSourceUrl','coverUrls'];
   const cleared=protectedCoverFields.filter(key=>{
     const before=base[key],after=record[key];
     return !empty(before)&&empty(after);
   });
   if(cleared.length)return {status:'conflict',reason:'protected-cover-cleared',fields:cleared};
   if(conflicts.length)return {status:'conflict',reason:'concurrent-field-edits',fields:conflicts};
   return {status:'merged',record};
 }
 // Pure planner: no writes, and never infer deletion from absence in a page.
 function planWithBaseline(baseRows,localRows,remoteRows){
   // Validate before indexing: malformed rows must not throw or collapse into a shared key.
   const allRows=[baseRows,localRows,remoteRows];
   if(allRows.some(rows=>!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'||r.id===null||r.id===undefined||String(r.id).trim()==='')))
     return {download:[],upload:[],merged:[],conflicts:[{reason:'missing-record-id'}],unchanged:[]};
   const base=new Map(baseRows.map(r=>[String(r.id),r]));
   const local=new Map(localRows.map(r=>[String(r.id),r]));
   const remote=new Map(remoteRows.map(r=>[String(r.id),r]));
   const decisions={download:[],upload:[],merged:[],conflicts:[],unchanged:[]};
  const duplicates=new Set();
  for(const rows of [baseRows,localRows,remoteRows]){
    const seen=new Set();
    for(const r of rows){
      const id=String(r.id);
      if(seen.has(id))duplicates.add(id);
      seen.add(id);
    }
  }
   // Invalid IDs cannot be reconciled safely: never coalesce null/undefined into a shared map key.
   for(const rows of [baseRows,localRows,remoteRows]){
     for(const r of rows){
       if(!r||r.id===null||r.id===undefined||String(r.id).trim()===''){
         decisions.conflicts.push({reason:'missing-record-id'});
       }
     }
   }
   if(decisions.conflicts.some(x=>x.reason==='missing-record-id'))return decisions;
   // A bibliographic issue appearing under multiple IDs is ambiguous. Never upload
   // or download either copy automatically, even when their IDs are individually valid.
   const identityIds=new Map();
   for(const rows of [baseRows,localRows,remoteRows])for(const row of rows){
     const key=identity(row);
     if(!key)continue;
     if(!identityIds.has(key))identityIds.set(key,new Set());
     identityIds.get(key).add(String(row.id));
   }
   const identityCollisions=new Set();
   for(const ids of identityIds.values())if(ids.size>1)for(const id of ids)identityCollisions.add(id);
   const keys=new Set([...base.keys(),...local.keys(),...remote.keys()]);
   for(const id of keys){
     if(duplicates.has(id)){decisions.conflicts.push({id,reason:'duplicate-id-in-input'});continue}
     if(identityCollisions.has(id)){decisions.conflicts.push({id,reason:'duplicate-bibliographic-identity-different-ids'});continue}
     const b=base.get(id),l=local.get(id),r=remote.get(id);
     // A stable ID must not silently switch to a different bibliographic issue.
     // Only compare complete identities; partial metadata is not evidence of a collision.
     const known=[b,l,r].filter(Boolean).map(identity).filter(Boolean);
     if(known.length>1&&new Set(known).size>1){
       decisions.conflicts.push({id,reason:'stable-id-bibliographic-identity-mismatch'});
       continue;
     }
     // Missing rows may be pagination gaps, never treat as tombstones.
     if(!l&&!r){decisions.conflicts.push({id,reason:'missing-both-without-tombstone'});continue}
     if(!b){
       // A tombstone without an acknowledged baseline is not a safe new record.
       // Block it rather than propagating an unverified deletion across devices.
       if((l&&l.deleted)||(r&&r.deleted)){
         decisions.conflicts.push({id,reason:'unverified-tombstone-without-baseline'});
         continue;
       }
       if(l&&!r)decisions.upload.push(l);
       else if(r&&!l)decisions.download.push(r);
       else if(JSON.stringify(l)===JSON.stringify(r))decisions.unchanged.push(id);
       else decisions.conflicts.push({id,reason:'no-baseline'});
       continue;
     }
     if(!l||!r){decisions.conflicts.push({id,reason:'missing-record-without-tombstone'});continue}
     const outcome=threeWay(b,l,r);
     if(outcome.status==='conflict')decisions.conflicts.push({id,...outcome});
     else if(outcome.status==='unchanged'||(JSON.stringify(outcome.record)===JSON.stringify(l)&&JSON.stringify(l)===JSON.stringify(r)))decisions.unchanged.push(id);
     else decisions.merged.push({id,record:outcome.record,needsLocal:JSON.stringify(outcome.record)!==JSON.stringify(l),needsRemote:JSON.stringify(outcome.record)!==JSON.stringify(r)});
   }
   // Fail closed for a batch containing any ambiguity: do not apply a partial
   // upload/download/merge while unresolved conflicts remain in the same snapshot.
   if(decisions.conflicts.length){
     decisions.download=[];
     decisions.upload=[];
     decisions.merged=[];
   }
   return decisions;
 }
 root.MCReconcileV2={identity,merge,reconcile,threeWay,planWithBaseline};
})(typeof window!=='undefined'?window:globalThis);
