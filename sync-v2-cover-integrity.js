'use strict';
/* MI COMICTECA V2 — isolated binary cover integrity gate.
 * No network writes. Verify bytes, not only filenames or Content-Length.
 * Call before accepting a remote object as an identical local cover.
 */
(function(root){
 const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 const validHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/i.test(x);
 async function sha256(blob,{cryptoImpl=root.crypto,maxBytes=20*1024*1024}={}){
   if(!blob||typeof blob.arrayBuffer!=='function'||!Number.isSafeInteger(blob.size)||blob.size<=0||blob.size>maxBytes)
     throw Error('Portada vacía, inválida o demasiado grande');
   if(!cryptoImpl?.subtle?.digest)throw Error('SHA-256 no disponible');
   return hex(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',await blob.arrayBuffer())));
 }
 async function verifyPair(local,remote,options={}){
   const a=await sha256(local,options),b=await sha256(remote,options);
   return {equal:a===b,localSha256:a,remoteSha256:b,localBytes:local.size,remoteBytes:remote.size};
 }
 async function verifyExpected(blob,expected,options={}){
   if(!validHash(expected))throw Error('Huella SHA-256 esperada inválida');
   const actual=await sha256(blob,options);
   return {equal:actual===expected.toLowerCase(),actualSha256:actual,expectedSha256:expected.toLowerCase()};
 }
 const api={sha256,verifyPair,verifyExpected};
 root.MCSyncV2CoverIntegrity=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
