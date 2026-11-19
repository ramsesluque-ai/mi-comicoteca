'use strict';
/* Isolated Sync V2 reconciliation contract. No production credentials or writes. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function reconcile(base, local, remote) {
  const ids = [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort();
  const plan = [];
  for (const id of ids) {
    const b=base.get(id), l=local.get(id), r=remote.get(id);
    const same=(a,c)=>sha(a??null)===sha(c??null);
    // A missing row is unknown, not a deletion. Only an explicit tombstone changes state.
    const lc=l!==undefined && !same(b,l), rc=r!==undefined && !same(b,r);
    let action='unchanged';
    if(lc&&rc) action=same(l,r)?'converged':'conflict';
    else if(lc) action='local-changed';
    else if(rc) action='remote-changed';
    // Missing records are not deletions. Only explicit tombstones may delete.
    if((l===undefined||r===undefined)&&b!==undefined && action!=='unchanged' && !(l?.deleted===true && same(b,r)) && !(r?.deleted===true && same(b,l))) action='conflict';
    if(action==='local-changed' && l?.deleted!==true && r===undefined && b!==undefined) action='conflict';
    if(action==='remote-changed' && r?.deleted!==true && l===undefined && b!==undefined) action='conflict';
    plan.push({id,action,localCoverKey:l?.coverKey,remoteCoverKey:r?.coverKey});
  }
  return plan;
}
const map = rows=>new Map(rows.map(x=>[x.local_id,x]));
const base=map([{local_id:'comics:7',title:'A',coverKey:'cover-a'}]);
const local=map([{local_id:'comics:7',title:'B',coverKey:'cover-a'}]);
const remote=map([{local_id:'comics:7',title:'C',coverKey:'cover-b'}]);
assert.equal(reconcile(base,local,remote)[0].action,'conflict','Concurrent edits cannot silently overwrite');
assert.equal(reconcile(base,local,base)[0].action,'local-changed');
assert.equal(reconcile(base,base,remote)[0].action,'remote-changed');
assert.equal(reconcile(base,local,local)[0].action,'converged');
assert.equal(reconcile(base,new Map(),base)[0].action,'unchanged','Absence alone must not delete');
assert.equal(reconcile(base,new Map(),local)[0].action,'conflict','Missing local row and remote edit must block');
const tomb=map([{local_id:'comics:7',deleted:true}]);
assert.equal(reconcile(base,tomb,remote)[0].action,'conflict','Tombstone versus concurrent edit must block');
assert.equal(reconcile(base,tomb,base)[0].action,'local-changed','Explicit tombstone can be planned');
const first=reconcile(base,local,remote);
assert.deepEqual(first,reconcile(base,local,remote),'Plan must be deterministic');
assert.equal(first[0].localCoverKey,'cover-a');
assert.equal(first[0].remoteCoverKey,'cover-b');
console.log('Sync V2 isolated reconciliation contract: 10 assertions passed; NO production writes.');
