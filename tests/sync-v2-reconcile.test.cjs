'use strict';
/* Run: node tests/sync-v2-reconcile.test.cjs — pure, no network or data writes */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sandbox={};sandbox.globalThis=sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sync-v2-reconcile.js'),'utf8'),sandbox);
const {threeWay,planWithBaseline,identity}=sandbox.MCReconcileV2;
const row={id:'comic-1',publisher:'Forum',series:'Spiderman',volume:'2',startYear:1992,issueNr:'1',title:'Original',coverUrl:'https://example.org/cover.jpg'};
const base={...row};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
assert.equal(identity(row),identity({...row,publisher:'FÓRUM',series:'SPIDERMAN'}));
let result=threeWay(base,{...base,title:'Edición local'},{...base,coverUrl:'https://example.org/new.jpg'});
assert.equal(result.status,'merged');assert.equal(result.record.title,'Edición local');assert.equal(result.record.coverUrl,'https://example.org/new.jpg');
result=threeWay(base,{...base,title:'Local'},{...base,title:'Nube'});
assert.equal(result.status,'conflict');assert.ok(result.fields.includes('title'));
result=threeWay(base,{id:base.id,deleted:true},{...base,title:'Nube'});
assert.equal(result.reason,'delete-versus-edit');
result=threeWay(base,{...base,deleted:true},{...base});
assert.equal(result.status,'merged');assert.equal(result.record.deleted,true);
result=threeWay(base,{...base,deleted:true},{...base,deleted:true});
assert.equal(result.status,'unchanged');
result=threeWay(base,{...base,deleted:true},{id:base.id,deleted:false});
assert.equal(result.reason,'delete-versus-edit');
result=threeWay(base,{...base,title:'Local'},{...base,title:'Local'});
assert.equal(result.status,'merged');assert.equal(result.record.title,'Local');
const p=planWithBaseline([base],[base],[base]);
assert.equal(p.conflicts.length,0);assert.equal(p.unchanged.length,1);
const missing=planWithBaseline([base],[],[base]);
assert.equal(missing.conflicts[0].reason,'missing-record-without-tombstone');
const newRow={...base,id:'new'};
assert.equal(planWithBaseline([], [newRow], []).upload.length,1);
assert.equal(planWithBaseline([], [], [newRow]).download.length,1);
assert.equal(planWithBaseline([], [newRow], [newRow]).unchanged.length,1);
const duplicate=planWithBaseline([base],[base,{...base,title:'Duplicada'}],[base]);
assert.equal(duplicate.conflicts.length,1);
assert.equal(duplicate.conflicts[0].reason,'duplicate-id-in-input');
assert.equal(duplicate.merged.length,0);
assert.equal(duplicate.upload.length,0);
const invalid=planWithBaseline([], [{...base,id:null}], []);
assert.equal(invalid.conflicts[0].reason,'missing-record-id');
assert.equal(invalid.upload.length,0);
const blank=planWithBaseline([], [{...base,id:'  '}], []);
assert.equal(blank.conflicts[0].reason,'missing-record-id');
assert.equal(blank.upload.length,0);
const tombstone={...base,deleted:true,deletedAt:'2026-11-11T00:00:00Z'};
result=threeWay(tombstone,{...tombstone,deleted:false},tombstone);
assert.equal(result.status,'conflict');assert.equal(result.reason,'tombstone-resurrection');
result=threeWay(tombstone,tombstone,{...tombstone,deleted:false});
assert.equal(result.reason,'tombstone-resurrection');
assert.equal(planWithBaseline([tombstone],[{...tombstone,deleted:false}],[tombstone]).conflicts[0].reason,'tombstone-resurrection');
// Malformed remote/local/base rows must fail closed rather than throwing or generating writes.
for (const bad of [null, undefined, {}, {id:null}, {id:''}, {id:'  '}]) {
  for (const slot of [0,1,2]) {
    const sets=[[base],[base],[base]];
    sets[slot]=[bad];
    const guarded=planWithBaseline(...sets);
    assert.equal(guarded.conflicts[0].reason,'missing-record-id');
    assert.equal(guarded.upload.length,0);
    assert.equal(guarded.download.length,0);
    assert.equal(guarded.merged.length,0);
  }
}

// A deletion marker without a confirmed common baseline must never be propagated.
for (const sets of [
  [[],[{...base,id:'orphan',deleted:true}],[]],
  [[],[],[{...base,id:'orphan',deleted:true}]],
  [[],[{...base,id:'orphan',deleted:true}],[{...base,id:'orphan',deleted:true}]]
]) {
  const planned=planWithBaseline(...sets);
  assert.equal(planned.conflicts[0].reason,'unverified-tombstone-without-baseline');
  assert.equal(planned.upload.length,0);
  assert.equal(planned.download.length,0);
  assert.equal(planned.merged.length,0);
}
// Stable IDs must never silently identify a different bibliographic issue.
const collision=planWithBaseline([base],[{...base,issueNr:'2'}],[base]);
assert.equal(collision.conflicts[0].reason,'stable-id-bibliographic-identity-mismatch');
assert.equal(collision.upload.length,0);
assert.equal(collision.download.length,0);
assert.equal(collision.merged.length,0);
// Unknown identity components should not be treated as proof of a collision.
const partial=planWithBaseline([base],[{...base,issueNr:null}],[base]);
assert.equal(partial.conflicts.length,0);
console.log('PASS: sync V2 assertions including duplicate-ID guard; no network, cloud or IndexedDB writes');

// Idempotence: applying an acknowledged merge twice must produce no additional writes.
const localEdit={...base,title:'Local title'};
const remoteEdit={...base,coverUrl:'https://example.org/revised.jpg'};
const first=planWithBaseline([base],[localEdit],[remoteEdit]);
assert.equal(first.conflicts.length,0);
assert.equal(first.merged.length,1);
const acknowledged=first.merged[0].record;
const second=planWithBaseline([acknowledged],[acknowledged],[acknowledged]);
assert.equal(second.conflicts.length,0);
assert.equal(second.unchanged.length,1);
assert.equal(second.upload.length+second.download.length+second.merged.length,0);
// Field removal is an edit, not an absent record or a reason to delete a comic.
const removed={...base};delete removed.synopsis;
const withSynopsis={...base,synopsis:'Original summary'};
const removedField=threeWay(withSynopsis,{...withSynopsis,synopsis:undefined},{...withSynopsis,coverUrl:'https://example.org/updated.jpg'});
assert.equal(removedField.status,'merged');
assert.equal(Object.hasOwn(removedField.record,'synopsis'),false);
assert.equal(removedField.record.coverUrl,'https://example.org/updated.jpg');

// Two IDs for the same complete bibliographic issue must not create duplicate comics.
for (const [baseline,local,remote] of [
  [[],[base],[{...base,id:'cloud-copy'}]],
  [[base],[base],[base,{...base,id:'cloud-copy'}]],
  [[],[base,{...base,id:'local-copy'}],[]]
]) {
  const planned=planWithBaseline(baseline,local,remote);
  assert.ok(planned.conflicts.some(c=>c.reason==='duplicate-bibliographic-identity-different-ids'));
  assert.equal(planned.upload.length,0);
  assert.equal(planned.download.length,0);
  assert.equal(planned.merged.length,0);
}
console.log('PASS: cross-ID bibliographic duplicate protection');

// A conflicted batch must never produce a partial write plan for unrelated rows.
const cleanExtra={...base,id:'safe-extra',series:'Otra serie'};
const mixed=planWithBaseline([base],[{...base,title:'Cambio local'},cleanExtra],[{...base,title:'Cambio remoto'}]);
assert.equal(mixed.conflicts[0].reason,'concurrent-field-edits');
assert.equal(mixed.upload.length,0);
assert.equal(mixed.download.length,0);
assert.equal(mixed.merged.length,0);
console.log('PASS: mixed-conflict batch blocks all automatic writes');
