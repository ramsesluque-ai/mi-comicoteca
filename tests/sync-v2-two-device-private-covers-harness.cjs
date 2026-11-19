'use strict';
// Isolated, deterministic two-device sync harness. No credentials, no production writes.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const signature = value => hash(Buffer.from(JSON.stringify(value)));
class FakePrivateStorage {
  constructor() { this.objects = new Map(); this.failGetOnce = false; }
  key(uid, coverKey) {
    assert.match(uid, /^[a-z0-9-]+$/);
    assert.match(coverKey, /^[a-z0-9-]+$/);
    return uid + '/' + coverKey;
  }
  put(uid, coverKey, bytes, expectedSha) {
    const key = this.key(uid, coverKey), actual = hash(bytes);
    if (actual !== expectedSha) throw Error('binary-sha-mismatch');
    const prior = this.objects.get(key);
    if (prior && hash(prior) !== actual) throw Error('cover-conflict');
    this.objects.set(key, Buffer.from(bytes));
  }
  get(uid, coverKey, expectedSha) {
    if (this.failGetOnce) { this.failGetOnce = false; throw Error('transient-get'); }
    const bytes = this.objects.get(this.key(uid, coverKey));
    if (!bytes) throw Error('missing-cover');
    if (hash(bytes) !== expectedSha) throw Error('binary-sha-mismatch');
    return Buffer.from(bytes);
  }
}
class FakeServer {
  constructor() { this.rows = new Map(); this.covers = new FakePrivateStorage(); }
  scoped(uid) { return this.rows.get(uid) ?? new Map(); }
  read(uid) { return new Map([...this.scoped(uid)].map(([id, value]) => [id, clone(value)])); }
  cas(uid, id, expected, next) {
    const rows = this.scoped(uid), prior = rows.get(id);
    if (signature(prior ?? null) !== signature(expected ?? null)) throw Error('concurrent-write');
    const updated = new Map(rows); updated.set(id, clone(next)); this.rows.set(uid, updated);
  }
}
function plan(baseline, local, remote) {
  const output = [];
  const ids = new Set([...baseline.keys(), ...local.keys(), ...remote.keys()]);
  for (const id of [...ids].sort()) {
    const b = baseline.get(id), l = local.get(id), r = remote.get(id);
    let action;
    if (!b) action = 'blocked-no-baseline';
    else if (!l || !r) action = 'blocked-missing-side';
    else {
      const lc = signature(l) !== signature(b), rc = signature(r) !== signature(b);
      action = lc && rc ? (signature(l) === signature(r) ? 'converged' : 'conflict')
        : lc ? 'upload' : rc ? 'download' : 'unchanged';
    }
    output.push({ id, action });
  }
  return output;
}
function syncOne({ uid, server, device, id }) {
  const base = device.baseline.get(id), local = device.rows.get(id), remote = server.read(uid).get(id);
  const step = plan(device.baseline, device.rows, server.read(uid)).find(x => x.id === id);
  if (step.action === 'upload') {
    server.cas(uid, id, remote, local);
    device.baseline.set(id, clone(local));
  } else if (step.action === 'download') {
    device.rows.set(id, clone(remote));
    device.baseline.set(id, clone(remote));
  } else if (step.action === 'converged' || step.action === 'unchanged') {
    device.baseline.set(id, clone(remote));
  }
  return step.action;
}
const server = new FakeServer(), uid = 'user-a', other = 'user-b', id = 'comic-1';
const original = {local_id:id, title:'Original', coverKey:'cover-1'};
server.cas(uid,id,null,original);
const device = () => ({rows:new Map([[id,clone(original)]]), baseline:new Map([[id,clone(original)]])});
const a = device(), b = device();
a.rows.get(id).title = 'Updated on A';
assert.equal(syncOne({uid,server,device:a,id}),'upload');
assert.equal(syncOne({uid,server,device:b,id}),'download');
assert.equal(b.rows.get(id).title,'Updated on A');
assert.equal(syncOne({uid,server,device:b,id}),'unchanged');
a.rows.get(id).title = 'A edit'; b.rows.get(id).title = 'B edit';
assert.equal(syncOne({uid,server,device:a,id}),'upload');
assert.equal(syncOne({uid,server,device:b,id}),'conflict');
assert.equal(server.read(uid).get(id).title,'A edit');
assert.equal(server.read(other).size,0,'RLS-like tenant isolation');
assert.throws(()=>server.cas(uid,id,original,{...original,title:'stale'}),/concurrent-write/);
const image = Buffer.from([0,1,2,255,0,42]), digest = hash(image);
server.covers.put(uid,'cover-1',image,digest);
assert.deepEqual(server.covers.get(uid,'cover-1',digest),image);
assert.throws(()=>server.covers.get(other,'cover-1',digest),/missing-cover/);
assert.throws(()=>server.covers.put(uid,'cover-1',Buffer.from([9]),digest),/binary-sha-mismatch/);
assert.throws(()=>server.covers.put(uid,'cover-1',Buffer.from([9]),hash(Buffer.from([9]))),/cover-conflict/);
server.covers.failGetOnce=true;
assert.throws(()=>server.covers.get(uid,'cover-1',digest),/transient-get/);
assert.deepEqual(server.covers.get(uid,'cover-1',digest),image,'retry GET verifies binary');
assert.equal(plan(new Map(),a.rows,server.read(uid))[0].action,'blocked-no-baseline');
const missing = device(); missing.rows.delete(id);
assert.equal(plan(missing.baseline,missing.rows,server.read(uid))[0].action,'blocked-missing-side');
const tomb = device(); tomb.rows.set(id,{...original,deleted:true});
assert.equal(plan(tomb.baseline,tomb.rows,new Map([[id,original]]))[0].action,'upload');
console.log('Sync V2 isolated two-device + private cover harness passed; production writes: ZERO.');
