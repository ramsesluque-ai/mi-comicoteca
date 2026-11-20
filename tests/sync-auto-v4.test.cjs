'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../sync-v3-core.js');
const engine=require('../sync-auto-v4.js');
const A={id:'c_1',publisher:'ECC',catalogHeader:'Batgirl',issueNr:1,coverKey:''};
const remote=(record,version='2026-11-20T11:00:00.000Z')=>({record,version});
const baseline={record:A,version:'2026-11-20T10:00:00.000Z'};
test('new mobile save queues a conditional insert, not a blind cloud overwrite',()=>{
 const decision=engine.decidePush({local:A,remote:null,baseline:null});
 assert.equal(decision.action,'insert');
 assert.equal(decision.expectedVersion,null);
});
test('a remote-only comic downloads to another device',()=>{
 assert.equal(engine.decidePull({local:null,remote:remote(A),pending:false}).action,'download');
});
test('same comic can establish baseline without extra writes',()=>{
 assert.equal(engine.decidePull({local:A,remote:remote({...A}),baseline:null,pending:false}).action,'ack');
 assert.equal(engine.decidePush({local:A,remote:remote({...A}),baseline:null}).action,'ack');
});
test('a pending offline edit cannot be replaced by a remote response',()=>{
 const d=engine.decidePull({local:{...A,publisher:'Local'},remote:remote(A),baseline,pending:true});
 assert.equal(d.action,'defer');
});
test('local edit only is a conditional update with remote version',()=>{
 const d=engine.decidePush({local:{...A,notes:'Purchased'},remote:remote(A),baseline});
 assert.equal(d.action,'update');
 assert.equal(d.expectedVersion,'2026-11-20T11:00:00.000Z');
});
test('remote edit only is downloaded, not overwritten',()=>{
 const d=engine.decidePull({local:A,remote:remote({...A,notes:'New device'}),baseline,pending:false});
 assert.equal(d.action,'download');
});
test('concurrent edits without acknowledged baseline fail closed',()=>{
 const d=engine.decidePush({local:{...A,notes:'Mobile'},remote:remote({...A,notes:'PC'}),baseline});
 assert.equal(d.action,'conflict');
 const first=engine.decidePush({local:{...A,notes:'Mobile'},remote:remote(A),baseline:null});
 assert.equal(first.action,'conflict');
});
test('remote tombstones and missing cloud rows never imply local deletion',()=>{
 assert.equal(engine.decidePull({local:A,remote:{...remote(A),deleted:true},baseline,pending:false}).action,'conflict');
 assert.equal(engine.decidePush({local:A,remote:null,baseline}).action,'conflict');
});
test('multiple account identities must never be treated as one',async()=>{
 const uid='11111111-1111-4111-8111-111111111111';
 const other='22222222-2222-4222-8222-222222222222';
 const cfg={url:'https://example.supabase.co',publishableKey:'pk'};
 const session={user:{id:uid},access_token:'token'};
 const unauthorized=async()=>({ok:true,status:200,json:async()=>({id:other})});
 await assert.rejects(core.verifySession({session,cfg,fetcher:unauthorized}),/differs/);
});
