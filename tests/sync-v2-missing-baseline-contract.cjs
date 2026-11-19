'use strict';
// Sync V2 baseline safety contract: missing state is UNKNOWN, never a deletion.
// Isolated fake two-device model. No production credentials or writes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const digest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snapshot = rows => new Map(rows.map(r => [r.local_id, structuredClone(r)]));
const equal = (a,b) => digest(a) === digest(b);
function plan(baseline, local, remote) {
  const ids = [...new Set([...baseline.keys(), ...local.keys(), ...remote.keys()])].sort();
  return ids.map(id => {
    const b=baseline.get(id), l=local.get(id), r=remote.get(id);
    if (!b) return {id,action:'blocked-no-baseline'};
    if (!l || !r) return {id,action:'blocked-missing-side'};
    const lc=!equal(b,l), rc=!equal(b,r);
    if (lc && rc && !equal(l,r)) return {id,action:'conflict'};
    if (lc && rc) return {id,action:'converged'};
    if (lc) return {id,action:l.deleted===true?'planned-local-tombstone':'planned-local-update'};
    if (rc) return {id,action:r.deleted===true?'planned-remote-tombstone':'planned-remote-update'};
    return {id,action:'unchanged'};
  });
}
const base=snapshot([{local_id:'comics:1',title:'Original',coverKey:'cover-1'}]);
const local=snapshot([{local_id:'comics:1',title:'Local',coverKey:'cover-1'}]);
const remote=snapshot([{local_id:'comics:1',title:'Remote',coverKey:'cover-2'}]);
assert.equal(plan(new Map(),local,remote)[0].action,'blocked-no-baseline');
assert.equal(plan(base,new Map(),remote)[0].action,'blocked-missing-side');
assert.equal(plan(base,local,new Map())[0].action,'blocked-missing-side');
assert.equal(plan(base,local,remote)[0].action,'conflict');
assert.equal(plan(base,local,base)[0].action,'planned-local-update');
assert.equal(plan(base,base,remote)[0].action,'planned-remote-update');
assert.equal(plan(base,local,local)[0].action,'converged');
const tomb=snapshot([{local_id:'comics:1',deleted:true}]);
assert.equal(plan(base,tomb,base)[0].action,'planned-local-tombstone');
assert.equal(plan(base,base,tomb)[0].action,'planned-remote-tombstone');
assert.equal(plan(base,tomb,remote)[0].action,'conflict');
assert.equal(plan(base,base,base)[0].action,'unchanged');
assert.deepEqual(plan(base,local,remote),plan(base,local,remote));
assert.equal(base.get('comics:1').title,'Original','planning must not mutate baseline');
assert.equal(local.get('comics:1').title,'Local','planning must not mutate local');
assert.equal(remote.get('comics:1').coverKey,'cover-2','planning must not mutate remote');
console.log('Sync V2 missing-baseline / two-device safety contract passed (15 assertions); NO production writes.');
