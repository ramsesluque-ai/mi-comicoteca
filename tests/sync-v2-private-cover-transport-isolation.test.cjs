'use strict';
// Isolated private-cover transport contract: two sessions, UID-scoped paths,
// tampered bytes, interrupted GET and retry. NO production credentials or writes.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
class PrivateStorageFake {
  constructor(){this.objects=new Map();this.failNextGet=false;}
  path(uid,key){
    if(typeof uid!=='string'||!/^test-user-[ab]$/.test(uid))throw Error('invalid-session');
    if(typeof key!=='string'||!/^cover-[a-z0-9-]+$/.test(key))throw Error('invalid-cover-key');
    return uid+'/'+key;
  }
  put(session,key,bytes){
    const path=this.path(session.uid,key);
    if(!session.authenticated)throw Error('unauthenticated');
    if(this.objects.has(path))throw Error('no-overwrite');
    this.objects.set(path,Buffer.from(bytes));
  }
  get(session,path){
    if(!session.authenticated)throw Error('unauthenticated');
    if(!path.startsWith(session.uid+'/'))throw Error('rls-denied');
    if(this.failNextGet){this.failNextGet=false;throw Error('transient-get-failure');}
    const value=this.objects.get(path);
    if(!value)throw Error('not-found');
    return Buffer.from(value);
  }
}
function receiveVerified(storage,session,path,expectedDigest){
  if(!/^[a-f0-9]{64}$/.test(expectedDigest))throw Error('invalid-digest');
  const binary=storage.get(session,path);
  if(sha256(binary)!==expectedDigest)throw Error('sha256-mismatch');
  return binary;
}
const store=new PrivateStorageFake();
const a={uid:'test-user-a',authenticated:true};
const b={uid:'test-user-b',authenticated:true};
const loggedOut={uid:'test-user-a',authenticated:false};
const cover=Buffer.from([0,255,1,2,128,42]);
const key='cover-one';
store.put(a,key,cover);
const path='test-user-a/'+key;
const hash=sha256(cover);
assert.throws(()=>store.get(b,path),/rls-denied/);
assert.throws(()=>store.get(loggedOut,path),/unauthenticated/);
assert.throws(()=>store.put(a,key,Buffer.from('different')),/no-overwrite/);
assert.throws(()=>store.put(a,'../escape',cover),/invalid-cover-key/);
store.failNextGet=true;
assert.throws(()=>receiveVerified(store,a,path,hash),/transient-get-failure/);
assert.deepEqual(receiveVerified(store,a,path,hash),cover);
store.objects.set(path,Buffer.from('tampered'));
assert.throws(()=>receiveVerified(store,a,path,hash),/sha256-mismatch/);
assert.equal(store.objects.size,1);
assert.equal(store.objects.has('test-user-b/'+key),false);
console.log('PASS isolated private cover fake: UID isolation, auth, no overwrite, binary SHA-256, GET retry and tamper rejection; NOT real Supabase RLS/browser E2E');
