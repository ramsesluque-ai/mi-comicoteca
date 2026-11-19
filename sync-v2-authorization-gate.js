'use strict';
/* MI COMICTECA Sync V2 — mandatory final authorization gate.
 * Pure, fail-closed; not wired to production. A planner proposal is never
 * authorization to write without a durable acknowledged baseline and E2E.
 */
(function(root){
 function authorize({plan,baseline,local,remote,backup,tests,coverProofs}={}){
  const reasons=[];
  if(!plan||!Array.isArray(plan.conflicts)||!Array.isArray(plan.upload)||!Array.isArray(plan.download)||!Array.isArray(plan.merged))
   reasons.push('invalid-plan');
  else if(plan.conflicts.length)reasons.push('unresolved-conflicts');
  if(!Array.isArray(baseline)||!Array.isArray(local)||!Array.isArray(remote))
   reasons.push('missing-snapshots');
  else {
   // Reject duplicate, malformed and cross-snapshot IDs before considering a write.
   // A Set alone hides duplicates and could make a truncated/ambiguous snapshot
   // appear acknowledged by the baseline.
   const ids=rows=>{
    const seen=new Set();let invalid=false;
    for(const row of rows){
     const id=row?.id;
     if(id===null||id===undefined||String(id).trim()===''||seen.has(String(id)))invalid=true;
     seen.add(String(id));
    }
    return {seen,invalid};
   };
   const b=ids(baseline),l=ids(local),r=ids(remote);
   if(b.invalid||l.invalid||r.invalid)reasons.push('invalid-or-duplicate-record-id');
   if([...new Set([...l.seen,...r.seen])].some(id=>!b.seen.has(id)))
    reasons.push('unacknowledged-baseline');
   if([...b.seen].some(id=>!l.seen.has(id)||!r.seen.has(id)))
    reasons.push('incomplete-snapshot-without-tombstone');
  }
  if(backup?.verified!==true||typeof backup.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(backup.sha256))
   reasons.push('unverified-backup');
  if(tests?.twoSessionE2E!==true||tests?.rlsIsolation!==true||tests?.retryAndFaults!==true)
   reasons.push('missing-e2e-evidence');
  const coverRefs=rows=>rows.some(row=>['coverKey','coverUrl','coverSourceUrl','coverUrls'].some(k=>Boolean(row?.[k]&&(Array.isArray(row[k])?row[k].length:true))));
  if(Array.isArray(local)&&Array.isArray(remote)&&(coverRefs(local)||coverRefs(remote))){
   if(coverProofs?.binarySha256Verified!==true||coverProofs?.authenticatedGetVerified!==true||coverProofs?.uidIsolationVerified!==true)
    reasons.push('unverified-private-covers');
  }
  // Deliberate hard block: this module cannot enable production writes.
  reasons.push('production-write-gate-disabled');
  return Object.freeze({safeToWrite:false,reasons:Object.freeze([...new Set(reasons)])});
 }
 const api=Object.freeze({authorize});
 root.MCSyncV2AuthorizationGate=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
