'use strict';
// Run: node tests/sync-v2-two-device-isolated.test.js
// Pure in-memory two-device regression; never connects to production Supabase.
const assert=require('node:assert/strict');
require('../sync-v2-reconcile.js');
const {planWithBaseline,threeWay}=globalThis.MCReconcileV2;
const row=(id,title,extra={})=>({id,publisher:'Editorial Prueba',series:'Serie de prueba',issue:'1',title,...extra});
const a=row('device-stable-1','Original',{coverKey:'cover-1',notes:'base'});
const clone=x=>JSON.parse(JSON.stringify(x));
let base=[clone(a)],deviceA=[clone(a)],deviceB=[clone(a)];
const cloud=[clone(a)];
const check=(name,fn)=>{fn();process.stdout.write('PASS '+name+'\n')};
check('two devices unchanged',()=>{
  for(const local of [deviceA,deviceB]){
    const p=planWithBaseline(base,local,cloud);
    assert.equal(p.conflicts.length,0);
    assert.equal(p.unchanged.length,1);
    assert.equal(p.upload.length+p.download.length+p.merged.length,0);
  }
});
check('independent edits merge without dropping cover',()=>{
  deviceA[0].notes='edited on A';
  cloud[0].title='Edited on B';
  const p=planWithBaseline(base,deviceA,cloud);
  assert.equal(p.conflicts.length,0);
  assert.equal(p.merged.length,1);
  assert.equal(p.merged[0].record.notes,'edited on A');
  assert.equal(p.merged[0].record.title,'Edited on B');
  assert.equal(p.merged[0].record.coverKey,'cover-1');
  assert.equal(p.merged[0].needsLocal,true);
  assert.equal(p.merged[0].needsRemote,true);
});
check('concurrent same-field edit blocks all writes',()=>{
  const l=[row('device-stable-1','Changed A')],r=[row('device-stable-1','Changed B')];
  const p=planWithBaseline(base,l,r);
  assert.equal(p.conflicts[0].reason,'concurrent-field-edits');
  assert.equal(p.upload.length+p.download.length+p.merged.length,0);
});
check('deletion versus edit is blocked',()=>{
  const l=[{...a,deleted:true,deletedAt:'2026-11-13T00:00:00Z'}],r=[{...a,notes:'edited'}];
  assert.equal(threeWay(a,l[0],r[0]).reason,'delete-versus-edit');
});
check('absence is not deletion',()=>{
  const p=planWithBaseline(base,[],cloud);
  assert.equal(p.conflicts[0].reason,'missing-record-without-tombstone');
});
check('new record downloads and retry is idempotent',()=>{
  const fresh=row('fresh-2','Second',{issue:'2'});
  const first=planWithBaseline([],[],[fresh]);
  assert.equal(first.download.length,1);
  const second=planWithBaseline([fresh],[fresh],[fresh]);
  assert.equal(second.unchanged.length,1);
  assert.equal(second.download.length+second.upload.length,0);
});
check('different IDs for same issue never create duplicate',()=>{
  const p=planWithBaseline([], [row('a','One')], [row('b','One')]);
  assert.ok(p.conflicts.length>0);
  assert.equal(p.download.length+p.upload.length,0);
});
check('unverified tombstone is blocked',()=>{
  const p=planWithBaseline([], [{...a,deleted:true}], []);
  assert.equal(p.conflicts[0].reason,'unverified-tombstone-without-baseline');
});
check('malformed or duplicate IDs are blocked',()=>{
  assert.ok(planWithBaseline([], [{...a,id:''}],[]).conflicts.length);
  assert.ok(planWithBaseline([], [a,a],[]).conflicts.length);
});
check('clearing an existing cover is an explicit conflict, not an automatic merge',()=>{
  const baseline=row('cover-protected','Original',{coverKey:'stored-cover',coverUrl:'https://example.test/cover.webp'});
  const local={...baseline,coverKey:'',coverUrl:''};
  const remote={...baseline};
  const p=planWithBaseline([baseline],[local],[remote]);
  assert.equal(p.conflicts[0].reason,'protected-cover-cleared');
  assert.equal(p.upload.length+p.download.length+p.merged.length,0);
});
check('adding a cover while another device edits notes remains mergeable',()=>{
  const baseline=row('cover-added','Original',{notes:'before'});
  const local={...baseline,coverKey:'new-cover'};
  const remote={...baseline,notes:'after'};
  const p=planWithBaseline([baseline],[local],[remote]);
  assert.equal(p.conflicts.length,0);
  assert.equal(p.merged[0].record.coverKey,'new-cover');
  assert.equal(p.merged[0].record.notes,'after');
});
console.log('Isolated reconciliation tests passed; NOT a Supabase RLS or browser E2E test.');
