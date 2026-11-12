'use strict';
// Pure, deterministic 16,523-record sync V2 load/regression test.
// No network, IndexedDB or user-data access.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sandbox={};sandbox.globalThis=sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sync-v2-reconcile.js'),'utf8'),sandbox);
const {planWithBaseline}=sandbox.MCReconcileV2;
const N=16523;
const base=Array.from({length:N},(_,i)=>({
 id:'original-'+String(i+1).padStart(5,'0'),
 publisher:'Editorial',series:'Serie '+Math.floor(i/100),
 volume:'1',startYear:2000,issueNr:String(i%100+1),
 title:'Original '+i,coverUrl:'https://example.org/'+i+'.jpg'
}));
const local=base.map(r=>({...r}));
const remote=base.map(r=>({...r}));
let p=planWithBaseline(base,local,remote);
assert.equal(p.conflicts.length,0);
assert.equal(p.unchanged.length,N);
assert.equal(p.upload.length+p.download.length+p.merged.length,0);
// Non-overlapping edits on different devices merge, preserving ID.
local[123]={...local[123],title:'Local update'};
remote[123]={...remote[123],coverUrl:'https://example.org/updated.jpg'};
p=planWithBaseline(base,local,remote);
assert.equal(p.conflicts.length,0);
assert.equal(p.merged.length,1);
assert.equal(p.merged[0].record.id,base[123].id);
assert.equal(p.merged[0].record.title,'Local update');
assert.equal(p.merged[0].record.coverUrl,'https://example.org/updated.jpg');
// An acknowledged second pass must be idempotent.
const acknowledged=base.map((r,i)=>i===123?p.merged[0].record:r);
p=planWithBaseline(acknowledged,acknowledged,acknowledged);
assert.equal(p.unchanged.length,N);
assert.equal(p.upload.length+p.download.length+p.merged.length+p.conflicts.length,0);
// A missing cloud page is not an instruction to delete a local comic.
p=planWithBaseline(base,base,base.slice(0,N-1));
assert.ok(p.conflicts.some(c=>c.id===base[N-1].id&&c.reason==='missing-record-without-tombstone'));
assert.equal(p.upload.length+p.download.length+p.merged.length,0);
// Same stable ID duplicated in one input must block that record.
p=planWithBaseline(base,[...base,base[50]],base);
assert.ok(p.conflicts.some(c=>c.id===base[50].id&&c.reason==='duplicate-id-in-input'));
assert.equal(p.upload.length+p.download.length+p.merged.length,0);
// Explicit deletion of a single acknowledged record must not affect the other 16,522.
const deletedLocal=base.map(r=>({...r}));
deletedLocal[500]={...deletedLocal[500],deleted:true,deletedAt:'2026-11-12T17:00:00Z'};
p=planWithBaseline(base,deletedLocal,base);
assert.equal(p.conflicts.length,0);
assert.equal(p.merged.length,1);
assert.equal(p.merged[0].id,base[500].id);
assert.equal(p.merged[0].record.deleted,true);
assert.equal(p.unchanged.length,N-1);
// A simultaneous edit to that same issue blocks every write in the batch.
const editedRemote=base.map(r=>({...r}));
editedRemote[500]={...editedRemote[500],title:'Concurrent cloud edit'};
p=planWithBaseline(base,deletedLocal,editedRemote);
assert.ok(p.conflicts.some(c=>c.id===base[500].id&&c.reason==='delete-versus-edit'));
assert.equal(p.upload.length+p.download.length+p.merged.length,0);
// An explicit tombstone acknowledged on both devices is idempotent.
const acknowledgedDelete=base.map((r,i)=>i===500?deletedLocal[i]:r);
p=planWithBaseline(acknowledgedDelete,acknowledgedDelete,acknowledgedDelete);
assert.equal(p.conflicts.length,0);
assert.equal(p.unchanged.length,N);
assert.equal(p.upload.length+p.download.length+p.merged.length,0);
console.log('PASS: 16,523-record tombstone propagation, delete/edit conflict and deletion idempotence');
console.log('PASS: 16,523 synthetic IDs, merge, idempotence, missing page and duplicate protection');
