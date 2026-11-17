'use strict';
// Isolated V2 reconciliation contract. Not loaded by production UI.
// No network, storage, or write side effects.
const crypto = require('node:crypto');
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function canonical(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (['bigint','undefined','function','symbol'].includes(typeof value)) throw Error('Unsupported value');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || !Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).every(Boolean)) throw Error('Sparse array');
    if (ancestors.has(value)) throw Error('Circular reference');
    ancestors.add(value);
    try { return value.map(item => canonical(item, ancestors)); }
    finally { ancestors.delete(value); }
  }
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw Error('Invalid object');
  if (ancestors.has(value)) throw Error('Circular reference');
  ancestors.add(value);
  try {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (['__proto__','constructor','prototype'].includes(key)) throw Error('Unsafe key');
      result[key] = canonical(value[key], ancestors);
    }
    return result;
  } finally { ancestors.delete(value); }
}
function fingerprint(record) {
  if (!record) return null;
  if (typeof record.local_id !== 'string' || !record.local_id.trim()) throw Error('Missing stable local_id');
  // Exclude server bookkeeping; preserve coverKey, coverUrl and explicit tombstones.
  const {updated_at, synced_at, user_id, ...payload} = record;
  return digest(canonical(payload));
}
function reconcile(local, remote, baseline) {
  const byId = rows => {
    const map = new Map();
    for (const row of rows) {
      const id = row.local_id;
      fingerprint(row);
      if (map.has(id)) throw Error('Duplicate local_id: '+id);
      map.set(id,row);
    }
    return map;
  };
  const l=byId(local), r=byId(remote), b=byId(baseline);
  const ids=[...new Set([...l.keys(),...r.keys(),...b.keys()])].sort();
  return ids.map(id=>{
    const left=l.get(id),right=r.get(id),base=b.get(id);
    const lh=fingerprint(left),rh=fingerprint(right),bh=fingerprint(base);
    // No baseline: never infer that absence means deletion.
    let action;
    if (!left && !right && base) action='conflict-missing-both';
    else if (lh===rh) action='unchanged';
    else if (base && (!left || !right)) action='conflict-implicit-deletion';
    else if (!base) action='conflict-unbaselined';
    else if (lh===bh && rh!==bh) action='download-candidate';
    else if (rh===bh && lh!==bh) action='upload-candidate';
    else action='conflict-concurrent';
    // All actions are advisory, never executable writes.
    return {local_id:id,action,local_hash:lh,remote_hash:rh,baseline_hash:bh};
  });
}
module.exports={canonical,fingerprint,reconcile};
if (require.main===module) {
  const assert=require('node:assert/strict');
  const mk=(id,title,extra={})=>({local_id:id,title,...extra});
  const a=mk('a','old'), b=mk('a','new');
  assert.equal(reconcile([a],[a],[a])[0].action,'unchanged');
  assert.equal(reconcile([b],[a],[a])[0].action,'upload-candidate');
  assert.equal(reconcile([a],[b],[a])[0].action,'download-candidate');
  assert.equal(reconcile([b],[mk('a','other')],[a])[0].action,'conflict-concurrent');
  assert.equal(reconcile([b],[],[])[0].action,'conflict-unbaselined');
  assert.equal(reconcile([],[],[a])[0].action,'conflict-missing-both');
  assert.equal(reconcile([], [a], [a])[0].action,'conflict-implicit-deletion');
  assert.equal(reconcile([a], [], [a])[0].action,'conflict-implicit-deletion');
  assert.equal(reconcile([mk('a','old',{deleted:true})],[a],[a])[0].action,'upload-candidate');
  assert.equal(reconcile([mk('a','old',{coverKey:'new'})],[a],[a])[0].action,'upload-candidate');
  assert.equal(reconcile([mk('a','old',{deleted:true})],[a],[a])[0].action,'upload-candidate');
  assert.throws(()=>reconcile([a,a],[],[]),/Duplicate/);
  assert.throws(()=>fingerprint({local_id:'a',value:Infinity}),/Invalid/);
  assert.throws(()=>fingerprint({local_id:'a',value:undefined}),/Unsupported/);
  assert.throws(()=>fingerprint({local_id:'a',value:[,1]}),/Sparse/);
  const cycle={}; cycle.self=cycle;
  assert.throws(()=>fingerprint({local_id:'a',value:cycle}),/Circular reference/);
  const arrayCycle=[]; arrayCycle.push(arrayCycle);
  assert.throws(()=>fingerprint({local_id:'a',value:arrayCycle}),/Circular reference/);
  const shared={value:1};
  assert.equal(fingerprint({local_id:'a',x:shared,y:shared}),fingerprint({local_id:'a',x:{value:1},y:{value:1}}));
  console.log('V2 isolated reconciliation: 18 checks passed (no writes)');
}
