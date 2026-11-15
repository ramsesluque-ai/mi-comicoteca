'use strict';
// End-to-end *isolated model* of two devices, one cloud and private cover bytes.
// No browser, credentials or production writes. The real authenticated E2E gate remains required.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
require('../sync-v2-reconcile.js');
const {planWithBaseline} = globalThis.MCReconcileV2;
const clone = x => JSON.parse(JSON.stringify(x));
const digest = b => createHash('sha256').update(b).digest('hex');
const row = (id,title,notes,coverKey) => ({id,publisher:'Test',series:'Test',issue:'1',title,notes,coverKey});
const original = row('stable-1','Original','initial','cover-1');
const binary = Buffer.from('isolated-private-cover-binary');
const remoteCovers = new Map([['user-a/cover-1',Buffer.from(binary)]]);
const deviceA = {rows:[],baseline:[],covers:new Map()};
const deviceB = {rows:[],baseline:[],covers:new Map()};
let remote = [clone(original)];
const plan = device => planWithBaseline(device.baseline,device.rows,remote);
function receive(device) {
  const p=plan(device);
  assert.equal(p.conflicts.length,0);
  assert.equal(p.upload.length+p.merged.length,0);
  for(const item of p.download) {
    const record=clone(item.record);
    assert.equal(record.coverKey,'cover-1');
    const stored=remoteCovers.get('user-a/'+record.coverKey);
    assert.ok(stored);
    const received=Buffer.from(stored);
    assert.equal(digest(received),digest(binary),'downloaded cover binary must match SHA-256');
    device.covers.set(record.coverKey,received);
    device.rows.push(record);
  }
  device.baseline=clone(remote);
}
receive(deviceA);
receive(deviceB);
assert.equal(deviceA.rows.length,1);
assert.equal(deviceB.rows.length,1);
assert.equal(digest(deviceB.covers.get('cover-1')),digest(binary));
// Device A edits a non-cover field, then simulates a successful acknowledged upload.
deviceA.rows[0].notes='edited on A';
let p=plan(deviceA);
assert.equal(p.conflicts.length,0);
assert.equal(p.upload.length,1);
assert.equal(p.download.length,0);
remote=clone(deviceA.rows);
deviceA.baseline=clone(remote);
// Device B receives the new version without losing its private binary.
p=plan(deviceB);
assert.equal(p.download.length,1);
deviceB.rows=clone(remote);
deviceB.baseline=clone(remote);
assert.equal(deviceB.rows[0].notes,'edited on A');
assert.equal(digest(deviceB.covers.get('cover-1')),digest(binary));
// Two independent edits to the same field must block every mutation.
deviceA.rows[0].title='from A';
deviceB.rows[0].title='from B';
remote=clone(deviceA.rows);
deviceA.baseline=clone(remote);
p=plan(deviceB);
assert.ok(p.conflicts.some(c=>c.reason==='concurrent-field-edits'));
assert.equal(p.upload.length+p.download.length+p.merged.length,0);
assert.equal(remote[0].title,'from A');
assert.equal(remoteCovers.size,1,'conflicts cannot create or overwrite cover objects');
console.log('PASS isolated two-device rows + cover SHA-256 roundtrip + conflict blocking; NOT browser/RLS E2E');
