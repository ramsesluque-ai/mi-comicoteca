'use strict';
// Isolated two-session retry/recovery harness. No network, credentials or owner data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sandbox={};
vm.runInNewContext(fs.readFileSync('sync-v2-reconcile.js','utf8'),sandbox,{filename:'sync-v2-reconcile.js'});
const {planWithBaseline}=sandbox.MCReconcileV2;
const row=(id,title,extra={})=>({id,publisher:'Test Publisher',series:'Series '+id,issue:'1',title,...extra});
const a=row('isolated-a','A');
const b=row('isolated-b','B');
const clone=x=>JSON.parse(JSON.stringify(x));
let remote=[],baseline=[],deviceA=[a,b],deviceB=[];
const first=planWithBaseline(baseline,deviceA,remote);
assert.equal(first.conflicts.length,0);
assert.equal(first.upload.length,2);
// Fake backend applies an atomic batch; a simulated network failure must not
// update the acknowledged baseline or mutate either device.
const before=JSON.stringify({remote,baseline,deviceA,deviceB});
try{throw Error('simulated network failure')}catch(e){assert.match(e.message,/network failure/)}
assert.equal(JSON.stringify({remote,baseline,deviceA,deviceB}),before);
const retry=planWithBaseline(baseline,deviceA,remote);
assert.deepEqual(JSON.parse(JSON.stringify(retry.upload)),JSON.parse(JSON.stringify(first.upload)));
// Successful simulated transaction and baseline acknowledgement.
remote=clone(retry.upload);
baseline=clone(remote);
deviceB=clone(remote);
const settled=planWithBaseline(baseline,deviceA,remote);
assert.equal(settled.conflicts.length,0);
assert.equal(settled.unchanged.length,2);
// Independent edits on separate sessions are merged only with a shared baseline.
deviceA[0].title='Edited on A';
remote[0].synopsis='Edited on B';
const merged=planWithBaseline(baseline,deviceA,remote);
assert.equal(merged.conflicts.length,0);
assert.equal(merged.merged.length,1);
assert.equal(merged.merged[0].record.title,'Edited on A');
assert.equal(merged.merged[0].record.synopsis,'Edited on B');
// Concurrent same-field edits must stop all writes, including unrelated changes.
deviceA[1].title='Competing A';
remote[1].title='Competing B';
const conflicted=planWithBaseline(baseline,deviceA,remote);
assert.equal(conflicted.conflicts[0].reason,'concurrent-field-edits');
assert.equal(conflicted.upload.length+conflicted.download.length+conflicted.merged.length,0);
// A partial backend page must never be interpreted as a deletion.
const incomplete=planWithBaseline(baseline,deviceA,[remote[0]]);
assert(incomplete.conflicts.some(x=>x.reason==='missing-record-without-tombstone'));
assert.equal(incomplete.upload.length+incomplete.download.length+incomplete.merged.length,0);
// Newly seen binary references must fail closed, even in otherwise valid batches.
const cover=planWithBaseline([], [row('isolated-cover','Cover',{coverKey:'private/isolated.jpg'}),row('isolated-plain','Plain')], []);
assert(cover.conflicts.some(x=>x.reason==='new-record-cover-unverified'));
assert.equal(cover.upload.length,0);
console.log('PASS: isolated two-session failure/retry, baseline, concurrent edits, partial pages and cover gate');
