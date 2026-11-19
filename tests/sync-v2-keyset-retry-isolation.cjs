'use strict';
// Isolated two-device keyset pagination and retry contract. No production credentials.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const rows = Array.from({length: 257}, (_,i)=>({
  local_id: 'comics:' + String(i).padStart(4,'0'),
  title: 'Comic '+i,
  coverKey: i%3===0 ? 'private/'+i : null
}));
function page(after, limit=37) {
  return rows.filter(r=>after===null || r.local_id>after).slice(0,limit);
}
function collect() {
  let cursor=null, result=[], seen=new Set(), iterations=0;
  while(true) {
    if(++iterations>20) throw new Error('pagination did not terminate');
    const batch=page(cursor);
    if(!batch.length) break;
    for(const r of batch) {
      assert(!seen.has(r.local_id), 'duplicate cursor row');
      seen.add(r.local_id);
      result.push(r);
    }
    cursor=batch.at(-1).local_id;
  }
  return result;
}
const first=collect();
assert.equal(first.length,257);
assert.deepEqual(first.map(x=>x.local_id),rows.map(x=>x.local_id));
assert.deepEqual(collect(),first,'keyset scan deterministic');
const server = new Map();
function putIfAbsent(row) {
  const current=server.get(row.local_id);
  if(current) {
    assert.deepEqual(current,row,'retry must not silently overwrite changed record');
    return 'already-present';
  }
  server.set(row.local_id,structuredClone(row));
  return 'created';
}
const row=first[0];
assert.equal(putIfAbsent(row),'created');
assert.equal(putIfAbsent(row),'already-present','lost response retry idempotent');
assert.throws(()=>putIfAbsent({...row,title:'concurrent edit'}),/overwrite/);
const uidA='user-a', uidB='user-b';
const storage=new Map();
function path(uid,key) { assert(/^[a-z0-9-]+$/.test(uid)); assert(/^cover-[a-z0-9-]+$/.test(key)); return uid+'/'+key; }
function upload(uid,key,bytes) {
  const p=path(uid,key), existing=storage.get(p), digest=hash(bytes);
  if(existing && existing.sha!==digest) throw Error('cover conflict');
  storage.set(p,{sha:digest,bytes:Buffer.from(bytes)});
  return digest;
}
function download(uid,key) {
  const record=storage.get(path(uid,key));
  return record ? Buffer.from(record.bytes) : null;
}
const bytes=Buffer.from([0,255,128,64,10,0,42]);
const sha=upload(uidA,'cover-7',bytes);
assert.equal(hash(download(uidA,'cover-7')),sha,'binary GET integrity');
assert.equal(download(uidB,'cover-7'),null,'other uid cannot read');
assert.equal(upload(uidA,'cover-7',bytes),sha,'cover retry idempotent');
assert.throws(()=>upload(uidA,'cover-7',Buffer.from([1,2,3])),/conflict/);
assert.throws(()=>path(uidA,'../user-b/cover-7'),/cover/);
console.log('Sync V2 isolated keyset/retry/cover contract passed. NO production writes.');
