'use strict';
/* Sync V2 baseline reconciliation: pure planning only, NEVER writes.
 * A missing record is not a deletion. Only explicit tombstones may delete,
 * and even those require a separate, verified execution gate.
 */
(function(root){
 const canon=v=>JSON.stringify(sort(v));
 // Treat all known cover pointers and integrity manifests as protected fields.
 const COVER_FIELDS=['coverKey','coverUrl','coverSourceUrl','coverUrls','coverHash','coverSha256','coverSHA256','coverDigest','coverMime','coverSize'];
 function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())if(v[k]!==undefined)o[k]=sort(v[k]);return o}return v}
 function index(rows,side){
  if(!Array.isArray(rows))throw Error(side+': expected array');
  const m=new Map();
  for(const row of rows){
   const rawId=row?.id;
   if(!((typeof rawId==='string'&&rawId.trim()===rawId&&rawId.length>0)||(typeof rawId==='number'&&Number.isSafeInteger(rawId)&&rawId>=0)))throw Error(side+': invalid stable ID');
   const id=String(rawId);
   if(m.has(id))throw Error(side+': missing or duplicate stable ID');
   m.set(id,row);
  }
  return m;
 }
 function plan({local,remote,baseline,tombstones=[]}){
  const l=index(local,'local'),r=index(remote,'remote'),b=index(baseline,'baseline');
  const deleted=new Set();
  for(const t of tombstones){
   const id=String(t?.id??'').trim();
   if(!id||deleted.has(id)||!t.explicit||!t.baseHash)throw Error('Invalid explicit tombstone');
   deleted.add(id);
  }
  const out={download:[],upload:[],identical:[],conflicts:[],deletionsBlocked:[],untracked:[],safeToExecute:false};
  for(const id of new Set([...l.keys(),...r.keys(),...b.keys(),...deleted])){
   const lv=l.get(id),rv=r.get(id),bv=b.get(id),lc=lv===undefined?null:canon(lv),rc=rv===undefined?null:canon(rv),bc=bv===undefined?null:canon(bv);
   if(deleted.has(id)){out.deletionsBlocked.push(id);continue}
   // Matching metadata on both devices does not prove the binary cover was copied.
   // Even identical cover references changed since baseline require a separate SHA-256 audit.
   if(bv&&lv&&rv&&COVER_FIELDS.some(field=>
     canon(lv[field]??null)===canon(rv[field]??null)&&canon(lv[field]??null)!==canon(bv[field]??null))){
     out.conflicts.push({id,reason:'cover-reference-changed-since-baseline'});
     continue;
   }
   // Both sides missing a previously tracked record is NOT a confirmed deletion.
   // Without a signed/explicit tombstone, never silently drop it from reconciliation.
   if(lc===rc){
    // Equality is not provenance. Two matching records absent from the
    // persisted baseline must remain untracked until separately verified.
    if(lc!==null){
     if(bc===null)out.untracked.push(id);
     else out.identical.push(id);
    }else if(bc!==null)out.conflicts.push({id,reason:'missing-on-both-sides-without-tombstone'});
    continue;
   }
   if(bc===null){out.untracked.push(id);continue}
   if(lc===null||rc===null){out.conflicts.push({id,reason:'missing-without-tombstone'});continue}
   // Cover references must never be propagated as ordinary bibliographic edits.
   // A changed coverKey/coverUrl requires a separately verified private binary
   // transfer; otherwise a merge could silently orphan a user's local image.
   if(COVER_FIELDS.some(field=>canon(lv[field]??null)!==canon(rv[field]??null))){
    out.conflicts.push({id,reason:'cover-reference-changed'});
    continue;
   }
   if(lc===bc)out.download.push(id);
   else if(rc===bc)out.upload.push(id);
   else out.conflicts.push({id,reason:'concurrent-edits'});
  }
  // No partial batch execution: any conflict or untracked ID blocks all proposals.
  // A missing baseline is never evidence that a record is safe to create.
  if(out.conflicts.length||out.untracked.length||out.deletionsBlocked.length){
   out.download=[];
   out.upload=[];
  }
  return out;
 }
 const api={plan,canonical:canon};
 root.MCSyncV2Baseline=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
