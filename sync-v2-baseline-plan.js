'use strict';
/* Sync V2 baseline reconciliation: pure planning only, NEVER writes.
 * A missing record is not a deletion. Only explicit tombstones may delete,
 * and even those require a separate, verified execution gate.
 */
(function(root){
 const canon=v=>JSON.stringify(sort(v));
 function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())if(v[k]!==undefined)o[k]=sort(v[k]);return o}return v}
 function index(rows,side){
  if(!Array.isArray(rows))throw Error(side+': expected array');
  const m=new Map();
  for(const row of rows){
   const id=String(row?.id??'').trim();
   if(!id||m.has(id))throw Error(side+': missing or duplicate stable ID');
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
   if(lc===rc){if(lc!==null)out.identical.push(id);continue}
   if(bc===null){out.untracked.push(id);continue}
   if(lc===null||rc===null){out.conflicts.push({id,reason:'missing-without-tombstone'});continue}
   // Cover references must never be propagated as ordinary bibliographic edits.
   // A changed coverKey/coverUrl requires a separately verified private binary
   // transfer; otherwise a merge could silently orphan a user's local image.
   if(['coverKey','coverUrl'].some(field=>canon(lv[field]??null)!==canon(rv[field]??null))){
    out.conflicts.push({id,reason:'cover-reference-changed'});
    continue;
   }
   if(lc===bc)out.download.push(id);
   else if(rc===bc)out.upload.push(id);
   else out.conflicts.push({id,reason:'concurrent-edits'});
  }
  return out;
 }
 const api={plan,canonical:canon};
 root.MCSyncV2Baseline=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
