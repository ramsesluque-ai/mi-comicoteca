// Isolated two-session synchronization contract; no production credentials or writes.
// Run: node --test tests/sync-v2-two-session-isolated.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
class FakePrivateBackend {
  constructor() { this.rows = new Map(); this.covers = new Map(); this.failNext = false; }
  guard(uid, path) {
    if (!uid || !path.startsWith(uid + '/')) throw new Error('RLS_DENIED');
  }
  async putRow(uid, row, expectedRevision) {
    if (this.failNext) { this.failNext = false; throw new Error('TRANSIENT'); }
    const key = uid + '/' + row.local_id;
    const current = this.rows.get(key);
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('CONFLICT');
    const next = { ...clone(row), revision: expectedRevision + 1 };
    this.rows.set(key, next);
    return clone(next);
  }
  async getRow(uid, localId) { return clone(this.rows.get(uid + '/' + localId) ?? null); }
  async uploadCover(uid, path, bytes, expectedHash) {
    this.guard(uid, path);
    if (sha(bytes) !== expectedHash) throw new Error('HASH_MISMATCH');
    const old = this.covers.get(path);
    if (old && sha(old) !== expectedHash) throw new Error('COVER_CONFLICT');
    if (!old) this.covers.set(path, Buffer.from(bytes));
  }
  async downloadCover(uid, path) {
    this.guard(uid, path);
    const bytes = this.covers.get(path);
    if (!bytes) throw new Error('NOT_FOUND');
    return Buffer.from(bytes);
  }
}
test('two sessions detect concurrent edits and preserve original', async () => {
  const api = new FakePrivateBackend();
  const a = await api.putRow('user-a', {local_id:'stable-1', title:'Original'}, 0);
  const baselineA = a.revision, baselineB = a.revision;
  await api.putRow('user-a', {local_id:'stable-1', title:'Device A'}, baselineA);
  await assert.rejects(api.putRow('user-a', {local_id:'stable-1', title:'Device B'}, baselineB), /CONFLICT/);
  assert.equal((await api.getRow('user-a','stable-1')).title, 'Device A');
  assert.equal(await api.getRow('user-b','stable-1'), null);
});
test('retry after transient error is bounded by revision and does not duplicate', async () => {
  const api = new FakePrivateBackend();
  api.failNext = true;
  await assert.rejects(api.putRow('user-a', {local_id:'id-2', title:'A'}, 0), /TRANSIENT/);
  const saved = await api.putRow('user-a', {local_id:'id-2', title:'A'}, 0);
  assert.equal(saved.revision, 1);
  await assert.rejects(api.putRow('user-a', {local_id:'id-2', title:'A'}, 0), /CONFLICT/);
});
test('private binary cover GET verifies SHA-256 and prevents cross-user reads/overwrite', async () => {
  const api = new FakePrivateBackend();
  const bytes = Buffer.from([0,255,17,128,0,64]);
  const path = 'user-a/stable-1/cover.bin';
  await api.uploadCover('user-a', path, bytes, sha(bytes));
  assert.equal(sha(await api.downloadCover('user-a',path)), sha(bytes));
  await assert.rejects(api.downloadCover('user-b',path), /RLS_DENIED/);
  await assert.rejects(api.uploadCover('user-a',path,Buffer.from([1]),sha(Buffer.from([1]))), /COVER_CONFLICT/);
  await assert.rejects(api.uploadCover('user-a','user-b/foreign',bytes,sha(bytes)), /RLS_DENIED/);
  await assert.rejects(api.uploadCover('user-a','user-a/bad',bytes,'0'.repeat(64)), /HASH_MISMATCH/);
});
