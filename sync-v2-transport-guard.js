'use strict';
/* Pure fail-closed preflight for manual sync. No browser APIs, no network writes. */
(function(root){
 function validate(input){
  const {uid,dbName,sessionUid,localRows,remoteRows,baselineRows,coverProofs}=input||{};
  const issues=[];
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(uid||''))||uid!==sessionUid)issues.push('account-mismatch');
  if(dbName!=='comicteca-user-'+uid)issues.push('indexeddb-owner-mismatch');
  for(const [name,rows] of [['local',localRows],['remote',remoteRows],['baseline',baselineRows]]){
   if(!Array.isArray(rows)){issues.push(name+'-not-loaded');continue}
   const seen=new Set();for(const row of rows){
    if(!row||row.id===null||row.id===undefined||String(row.id).trim()===''){issues.push(name+'-invalid-id');continue}
    const id=String(row.id);if(seen.has(id))issues.push(name+'-duplicate-id');seen.add(id);
    if(name==='remote'&&row.user_id!==undefined&&row.user_id!==uid)issues.push('remote-owner-mismatch');
   }
  }
  if(!Array.isArray(coverProofs))issues.push('cover-proofs-not-loaded');
  else for(const proof of coverProofs){
   if(!proof||proof.uid!==uid||!proof.key||!/^([a-f0-9]{64})$/i.test(proof.localSha256||'')||proof.localSha256!==proof.remoteSha256||proof.getVerified!==true)issues.push('cover-unverified');
  }
  return {safe:issues.length===0,issues:[...new Set(issues)]};
 }
 const api={validate};if(typeof module==='object'&&module.exports)module.exports=api;root.MCSyncV2TransportGuard=api;
})(typeof window!=='undefined'?window:globalThis);
