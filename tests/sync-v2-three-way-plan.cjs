'use strict';
// Pure, read-only three-way reconciliation contract. Synthetic data only.
// Deliberately returns proposals, NEVER performs network or database writes.
const {canonical}=require('../sync-v2-manual-plan.js');
function plan({baseline,local,cloud}){
 if(!Array.isArray(baseline)||!Array.isArray(local)||!Array.isArray(cloud))throw Error('arrays required');
 const index=(rows,label)=>{const m=new Map();for(const row of rows){
  if(!row||typeof row.local_id!=='string'||!/^comics:[^\s]+$/.test(row.local_id))throw Error(label+': invalid stable local_id');
  if(m.has(row.local_id))throw Error(label+': duplicate local_id');
  if(typeof row.deleted!=='boolean')throw Error(label+': explicit tombstone state required');
  if(!row.deleted&&(!row.record||String(row.record.id)!==row.local_id.slice(7)))throw Error(label+': record ID mismatch');
  m.set(row.local_id,row);
 }return m;};
 const b=index(baseline,'baseline'),l=index(local,'local'),c=index(cloud,'cloud');
 const eq=(x,y)=>x===undefined&&y===undefined||x!==undefined&&y!==undefined&&canonical(x)===canonical(y);
 const proposals=[];
 for(const key of [...new Set([...b.keys(),...l.keys(),...c.keys()])].sort()){
  const old=b.get(key),left=l.get(key),right=c.get(key);
  // No baseline: even an apparently new record is NOT automatically uploadable.
  if(!old){proposals.push({local_id:key,status:'review-no-baseline'});continue;}
  // A missing row is not a deletion; only an explicit tombstone may represent one.
  if(!left||!right){proposals.push({local_id:key,status:'review-missing-row'});continue;}
  const lc=eq(left,old),rc=eq(right,old);
  let status;
  if(eq(left,right))status='equal';
  else if(lc&&!rc)status=right.deleted?'review-cloud-tombstone':'candidate-download';
  else if(rc&&!lc)status=left.deleted?'review-local-tombstone':'candidate-upload';
  else status='conflict';
  // Any cover pointer changes must be inspected separately from record metadata.
  if(status.startsWith('candidate-')&&
    (!eq(left.record?.coverKey,right.record?.coverKey)||!eq(left.record?.coverUrl,right.record?.coverUrl)))
   status='review-cover-reference';
  proposals.push({local_id:key,status});
 }
 return {readOnly:true,safeToWrite:false,proposals};
}
module.exports={plan};
