'use strict';
// Isolated reconciliation contract: no network, no production collection access.
// Run: node tests/sync-reconciliation-contract.cjs
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const equal=(a,b)=>a===undefined&&b===undefined||(a!==undefined&&b!==undefined&&hash(a)===hash(b));
function plan(base,local,remote){
 const ids=[...new Set([...base.keys(),...local.keys(),...remote.keys()])].sort();
 return ids.map(id=>{
  const b=base.get(id),l=local.get(id),r=remote.get(id);
  const lc=!equal(l,b),rc=!equal(r,b);
  let action='conflict';
  if(equal(l,r))action='noop';
  else if(!b&&l&&!r)action='upload-new';
  else if(!b&&r&&!l)action='download-new';
  else if(!b&&l&&r)action='conflict';
  else if(!l||!r)action='conflict'; // missing != tombstone
  else if(lc&&rc)action='conflict';
  else if(lc)action='upload-change';
  else if(rc)action='download-change';
  return {id,action};
 });
}
const map=rows=>new Map(rows.map(x=>[x.local_id,x]));
const a={local_id:'a',title:'A',coverKey:'private/a.png'},b={...a,title:'B'},c={...a,title:'C'};
const cases=[
 ['remote edit',map([a]),map([a]),map([b]),'download-change'],
 ['local edit',map([a]),map([b]),map([a]),'upload-change'],
 ['concurrent edits',map([a]),map([b]),map([c]),'conflict'],
 ['coverKey edit',map([a]),map([{...a,coverKey:'private/new.png'}]),map([a]),'upload-change'],
 ['missing row is not deletion',map([a]),map([]),map([a]),'conflict'],
 ['tombstone versus edit',map([a]),map([{...a,deleted_at:'2026-11-17T00:00:00Z'}]),map([b]),'conflict'],
 ['same id divergent addition',map([]),map([a]),map([b]),'conflict']
];
for(const [name,base,local,remote,expected] of cases){
 assert.equal(plan(base,local,remote)[0].action,expected,name);
 console.log('PASS',name);
}
assert.deepEqual(plan(map([]),map([a]),map([{local_id:'z',title:'Z'}])).map(x=>x.action),['upload-new','download-new']);
console.log('PASS independent additions');
module.exports={plan};
