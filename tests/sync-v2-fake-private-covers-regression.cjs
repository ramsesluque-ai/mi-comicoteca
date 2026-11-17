'use strict';
// Synthetic cover transfer contract. No production credentials, storage or network.
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const UID_A='11111111-1111-4111-8111-111111111111';
const UID_B='22222222-2222-4222-8222-222222222222';
const digest=b=>createHash('sha256').update(b).digest('hex');
class FakePrivateStorage {
 constructor(){this.objects=new Map();this.failNextGet=false;this.failNextPut=false;this.corruptNextGet=false;}
 key(uid,path){assert.match(uid,/^[a-f0-9-]{36}$/);assert(path.startsWith(uid+'/covers/'),'uid-scoped path required');assert(!path.includes('..'));return path;}
 async put(uid,path,bytes,{expectedHash,overwrite=false}={}){
  const key=this.key(uid,path);
  if(this.failNextPut){this.failNextPut=false;throw Error('503 simulated PUT');}
  assert.equal(digest(bytes),expectedHash,'binary SHA-256 before PUT');
  if(this.objects.has(key)&&!overwrite)throw Error('immutable object collision');
  this.objects.set(key,Buffer.from(bytes));
 }
 async get(uid,path){
  const key=this.key(uid,path);
  if(this.failNextGet){this.failNextGet=false;throw Error('503 simulated GET');}
  const bytes=this.objects.get(key);
  if(!bytes)throw Error('404');
  if(this.corruptNextGet){this.corruptNextGet=false;return Buffer.from('corrupted remote payload');}
  return Buffer.from(bytes);
 }
}
async function uploadVerified(storage,uid,bytes){
 const hash=digest(bytes),path=uid+'/covers/'+hash+'.bin';
 await storage.put(uid,path,bytes,{expectedHash:hash});
 const fetched=await storage.get(uid,path);
 assert.equal(digest(fetched),hash,'GET verification SHA-256 mismatch');
 return {path,hash};
}
(async()=>{
 const storage=new FakePrivateStorage();
 const original=Buffer.from([0,255,1,2,3,0,128,10]);
 const a=await uploadVerified(storage,UID_A,original);
 assert.deepEqual(await storage.get(UID_A,a.path),original);
 console.log('PASS binary roundtrip PUT/GET SHA-256');
 await assert.rejects(()=>storage.get(UID_B,a.path),/uid-scoped/);
 console.log('PASS cross-account private path rejected');
 await assert.rejects(()=>storage.put(UID_A,a.path,Buffer.from('tamper'),{expectedHash:a.hash}),/SHA-256/);
 await assert.rejects(()=>storage.put(UID_A,a.path,original,{expectedHash:a.hash}),/collision/);
 assert.deepEqual(await storage.get(UID_A,a.path),original);
 console.log('PASS mismatch and overwrite rejected, original intact');
 storage.failNextPut=true;
 await assert.rejects(()=>uploadVerified(storage,UID_A,Buffer.from('new')),/503/);
 assert.equal(storage.objects.size,1);
 console.log('PASS failed PUT does not mutate existing cover');
 storage.failNextGet=true;
 await assert.rejects(()=>uploadVerified(storage,UID_A,Buffer.from('another')),/503/);
 console.log('PASS failed verification GET blocks completion');
 const same=await storage.get(UID_A,a.path);
 assert.equal(digest(same),a.hash);
 console.log('PASS original cover survives failed verification');
 storage.corruptNextGet=true;
 await assert.rejects(()=>uploadVerified(storage,UID_A,Buffer.from('checksum-check')),/GET verification SHA-256 mismatch/);
 console.log('PASS silent remote corruption detected by binary checksum');
 const retryBytes=Buffer.from('retry-after-unverified-write');
 storage.failNextGet=true;
 await assert.rejects(()=>uploadVerified(storage,UID_A,retryBytes),/503/);
 const retryHash=digest(retryBytes),retryPath=UID_A+'/covers/'+retryHash+'.bin';
 assert.equal(digest(await storage.get(UID_A,retryPath)),retryHash);
 await assert.rejects(()=>uploadVerified(storage,UID_A,retryBytes),/immutable object collision/);
 console.log('PASS unverified immutable object cannot be silently overwritten on retry');
})().catch(e=>{console.error(e);process.exitCode=1});
