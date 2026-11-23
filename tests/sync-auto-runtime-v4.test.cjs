'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function createSandbox(){
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/,'production writes must remain gated until real E2E');
 // Enable ONLY inside an isolated VM so scheduled jobs can be tested safely.
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const events=new Map(),documentEvents=new Map(),timers=new Map();
 let timerId=0;
 const uid='11111111-1111-4111-8111-111111111111';
 const doc={readyState:'loading',hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn)};
 let release;
 const firstJob=new Promise(resolve=>{release=resolve});
 const calls=[];
 const win={
  document:doc,
  MI_COMICOTECA_CLOUD:{url:'https://example.supabase.co',publishableKey:'test'},
  MCAutoCoversV4:{},
  MCAutoSyncV4:{
   syncNow:async()=>{calls.push('syncNow');await firstJob;return {sent:{pending:0,uploaded:1,conflicts:[]},received:{downloaded:0,conflicts:[]}}},
   uploadQueued:async()=>{calls.push('uploadQueued');return {pending:0,uploaded:1,conflicts:[]}},
   pull:async()=>{calls.push('pull');return {downloaded:0,conflicts:[]}}
  },
  addEventListener:(name,fn)=>events.set(name,fn),
  dispatchEvent:()=>{}
 };
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 function fireTimer(ms){const entry=[...timers.entries()].find(([id,t])=>t.ms===ms);
  if(!entry)throw Error('Timer not found '+ms);
  const [id,t]=entry;timers.delete(id);t.fn();
 }
 return {events,documentEvents,timers,calls,win,fireTimer,release};
}
test('a save while initial cloud sync is running schedules a later upload',async()=>{
 const sandbox=createSandbox();
 sandbox.documentEvents.get('DOMContentLoaded')();
 sandbox.fireTimer(100); // automatic open begins
 assert.deepEqual(sandbox.calls,['syncNow']);
 sandbox.events.get('mc-local-comic-saved')();
 sandbox.fireTimer(800); // save debounced during in-flight cloud read
 assert.deepEqual(sandbox.calls,['syncNow']);
 sandbox.release();
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.deepEqual(sandbox.calls,['syncNow','uploadQueued']);
});
test('automatic V4 runtime does not send writes while production release gate is closed',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 assert.doesNotMatch(source,/localStorage\.getItem\(['"]release/i);
});

test('production release gate blocks sync on startup, save and network reconnection',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 const events=new Map(),documentEvents=new Map(),timers=[];
 const calls=[];
 const uid='11111111-1111-4111-8111-111111111111';
 const win={
  document:{readyState:'loading',hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn)},
  MI_COMICOTECA_CLOUD:{url:'https://example.supabase.co',publishableKey:'test'},
  MCAutoCoversV4:{},
  MCAutoSyncV4:{
   syncNow:async()=>calls.push('syncNow'),
   uploadQueued:async()=>calls.push('uploadQueued'),
   pull:async()=>calls.push('pull')
  },
  addEventListener:(name,fn)=>events.set(name,fn),
  dispatchEvent:()=>{}
 };
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},
  clearTimeout:()=>{}};
 vm.runInNewContext(source,ctx,{filename:'sync-auto-runtime-v4.js'});
 documentEvents.get('DOMContentLoaded')?.();
 for(const name of ['mc-local-comic-saved','online','focus']){
  events.get(name)?.();
 }
 for(const timer of timers.slice(0,20))timer.fn();
 await Promise.resolve();
 await Promise.resolve();
 assert.deepEqual(calls,[],'disabled production gate must never call cloud sync');
 assert.equal(win.MCAutoSyncRuntimeV4?.enabled,false);
});

test('transient upload failures retry with exponential backoff, but CAS conflicts do not loop',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const events=new Map(),documentEvents=new Map(),timers=new Map(),delays=[];
 let seq=0,uploads=0;
 const win={
  document:{readyState:'loading',hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn)},
  MI_COMICOTECA_CLOUD:{url:'https://example.supabase.co',publishableKey:'test'},
  MCAutoCoversV4:{},
  MCAutoSyncV4:{
   syncNow:async()=>({sent:{pending:0,uploaded:0,conflicts:[]},received:{downloaded:0,conflicts:[]}}),
   pull:async()=>({downloaded:0,conflicts:[]}),
   uploadQueued:async()=>{
    uploads++;
    if(uploads<=2)return {pending:1,uploaded:0,conflicts:[{reason:'HTTP 503'}]};
    return {pending:1,uploaded:0,conflicts:[{reason:'CAS version conflict'}]};
   }
  },
  addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent:()=>{}
 };
 const uid='11111111-1111-4111-8111-111111111111';
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});delays.push(ms);return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 documentEvents.get('DOMContentLoaded')();
 // The startup kick (100ms) is unrelated to this retry-only scenario.
 // Remove that isolated VM timer so it cannot masquerade as a retry timer.
 assert.equal([...timers.values()].filter(t=>t.ms===100).length,1);
 for(const [id,t] of timers)if(t.ms===100)timers.delete(id);
 await win.MCAutoSyncRuntimeV4.uploadQueued();
 for(const delay of [5000,10000]){
  assert.equal(timers.size,1,'a transient failure schedules exactly one retry');
  const entry=[...timers.entries()][0];
  assert.equal(entry[1].ms,delay);
  timers.delete(entry[0]);
  entry[1].fn();
  for(let i=0;i<12;i++)await Promise.resolve();
 }
 assert.equal(uploads,3);
 assert.equal(timers.size,0,'CAS conflicts must not trigger a busy retry loop');
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().lastConflicts,1);
});

test('account UID and private IndexedDB namespace must match before any cloud operation',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const other='22222222-2222-4222-8222-222222222222';
 for(const [account,dbName] of [
  [uid,'comicteca-user-'+other],
  [uid,'comicteca-guest-v1'],
  ['not-a-uid','comicteca-user-not-a-uid']
 ]){
  const calls=[];
  const win={MCAutoCoversV4:{},MCAutoSyncV4:{
   syncNow:async()=>{calls.push('syncNow')},
   pull:async()=>{calls.push('pull')},
   uploadQueued:async()=>{calls.push('uploadQueued')}
  },dispatchEvent:()=>{}};
  const ctx={window:win,db:{},DBN:dbName,MC_ACCOUNT_ID:account,MC_IMPORT_TEST:false,
   CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
   console,Promise,Date,setTimeout,clearTimeout};
  vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
  await assert.rejects(win.MCAutoSyncRuntimeV4.syncNow(),/Cuenta y almacén privado no coinciden/);
  await assert.rejects(win.MCAutoSyncRuntimeV4.uploadQueued(),/Cuenta y almacén privado no coinciden/);
  assert.deepEqual(calls,[],'mismatched UID must never reach cloud transport');
 }
});

test('rejected HTTP 503 transport retries, then succeeds without dropping the outbox',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const timers=new Map();let seq=0,attempts=0;
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  uploadQueued:async()=>{attempts++;if(attempts===1)throw Error('HTTP 503');return {pending:0,uploaded:1,conflicts:[]}},
  syncNow:async()=>({sent:{pending:0,conflicts:[]},received:{downloaded:0}}),
  pull:async()=>({downloaded:0})
 },dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 await assert.rejects(win.MCAutoSyncRuntimeV4.uploadQueued(),/HTTP 503/);
 assert.equal(timers.size,1);
 const [id,timer]=[...timers.entries()][0];
 assert.equal(timer.ms,5000);
 timers.delete(id);timer.fn();
 for(let i=0;i<16;i++)await Promise.resolve();
 assert.equal(attempts,2);
 assert.equal(timers.size,0);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().pending,0);
});

test('successful manual retry cancels obsolete scheduled HTTP retry',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const timers=new Map();let seq=0,attempts=0;
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  uploadQueued:async()=>{
   attempts++;
   return attempts===1
    ? {pending:1,uploaded:0,conflicts:[{reason:'HTTP 503'}]}
    : {pending:0,uploaded:1,conflicts:[]};
  },
  syncNow:async()=>({sent:{pending:0,uploaded:1,conflicts:[]},received:{downloaded:0,conflicts:[]}}),
  pull:async()=>({downloaded:0,conflicts:[]})
 },dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,
  setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 await win.MCAutoSyncRuntimeV4.uploadQueued();
 assert.equal(timers.size,1);
 assert.equal([...timers.values()][0].ms,5000);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().scheduled,true);
 await win.MCAutoSyncRuntimeV4.uploadQueued();
 assert.equal(attempts,2);
 assert.equal(timers.size,0,'successful retry must cancel old scheduled timer');
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().scheduled,false);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().pending,0);
});


test('failed initial cloud pull retries full reconciliation, never push-only',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const timers=new Map();let seq=0,syncAttempts=0,pushAttempts=0;
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  syncNow:async()=>{syncAttempts++;if(syncAttempts===1)throw Error('HTTP 503');return {sent:{pending:0,uploaded:0,conflicts:[]},received:{downloaded:1,conflicts:[]}}},
  uploadQueued:async()=>{pushAttempts++;return {pending:0,uploaded:0,conflicts:[]}},
  pull:async()=>({downloaded:1,conflicts:[]})
 },dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 await assert.rejects(win.MCAutoSyncRuntimeV4.syncNow(),/HTTP 503/);
 assert.equal(timers.size,1);
 const [id,t]=[...timers.entries()][0];
 assert.equal(t.ms,5000);
 timers.delete(id);t.fn();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(syncAttempts,2,'full reconciliation must retry after transient failure');
 assert.equal(pushAttempts,0,'retry must not silently become push-only');
 assert.equal(timers.size,0);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().lastDownloads,1);
});

test('pending HTTP error during full reconciliation retries both pull and push',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const timers=new Map();let seq=0,syncAttempts=0,pushAttempts=0;
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  syncNow:async()=>{syncAttempts++;return syncAttempts===1
   ? {sent:{pending:1,uploaded:0,conflicts:[{reason:'HTTP 503'}]},received:{downloaded:0,conflicts:[]}}
   : {sent:{pending:0,uploaded:1,conflicts:[]},received:{downloaded:1,conflicts:[]}};},
  uploadQueued:async()=>{pushAttempts++;return {pending:0,conflicts:[]}},
  pull:async()=>({downloaded:0})
 },dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 await win.MCAutoSyncRuntimeV4.syncNow();
 assert.equal(timers.size,1);
 const [id,t]=[...timers.entries()][0];assert.equal(t.ms,5000);
 timers.delete(id);t.fn();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(syncAttempts,2,'retry must repeat full reconciliation');
 assert.equal(pushAttempts,0,'retry must not skip pull');
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().pending,0);
});

test('a new local save replaces an obsolete retry and keeps scheduled status accurate',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const events=new Map(),timers=new Map();let seq=0,uploads=0;
 const win={document:{readyState:'loading',addEventListener:(name,fn)=>events.set(name,fn)},
  MCAutoCoversV4:{},MCAutoSyncV4:{
   uploadQueued:async()=>{uploads++;return {pending:1,conflicts:[{reason:'HTTP 503'}]}},
   syncNow:async()=>({sent:{pending:0,conflicts:[]},received:{downloaded:0}}),
   pull:async()=>({downloaded:0})
  },addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 // Runtime listeners are installed at DOMContentLoaded; isolate the startup kick timer.
 events.get('DOMContentLoaded')();
 timers.clear();
 await win.MCAutoSyncRuntimeV4.uploadQueued();
 assert.equal([...timers.values()][0].ms,5000);
 events.get('mc-local-comic-saved')();
 assert.equal(timers.size,1);
 assert.equal([...timers.values()][0].ms,800);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().scheduled,true);
 const [id,t]=[...timers.entries()][0];timers.delete(id);t.fn();
 for(let i=0;i<16;i++)await Promise.resolve();
 assert.equal(uploads,2);
 assert.equal([...timers.values()][0].ms,10000);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().scheduled,true);
});

test('save during failed full reconciliation preserves pull on retry',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const events=new Map(),timers=new Map();let seq=0,syncs=0,pushes=0;
 const win={document:{readyState:'loading',addEventListener:(n,fn)=>events.set(n,fn)},
  MCAutoCoversV4:{},MCAutoSyncV4:{
   syncNow:async()=>{syncs++;if(syncs===1)throw Error('HTTP 503');return {sent:{pending:0,conflicts:[]},received:{downloaded:1,conflicts:[]}}},
   uploadQueued:async()=>{pushes++;return {pending:0,conflicts:[]}},
   pull:async()=>({downloaded:0})
  },addEventListener:(n,fn)=>events.set(n,fn),dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 events.get('DOMContentLoaded')();
 timers.clear(); // ignore automatic startup timer for this isolated scenario
 await assert.rejects(win.MCAutoSyncRuntimeV4.syncNow(),/HTTP 503/);
 assert.equal([...timers.values()][0].ms,5000);
 events.get('mc-local-comic-saved')();
 assert.equal(timers.size,1);
 const [id,t]=[...timers.entries()][0];
 assert.equal(t.ms,800);
 timers.delete(id);t.fn();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(syncs,2,'save must retain full reconciliation');
 assert.equal(pushes,0,'must not degrade to push-only');
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().lastDownloads,1);
});


test('successful push ACK does not cancel a scheduled failed full pull retry',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const timers=new Map();let seq=0,full=0,push=0;
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  syncNow:async()=>{full++;if(full===1)throw Error('HTTP 503');return {sent:{pending:0,conflicts:[]},received:{downloaded:1,conflicts:[]}};},
  uploadQueued:async()=>{push++;return {pending:0,uploaded:1,conflicts:[]};},
  pull:async()=>({downloaded:0})
 },dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 await assert.rejects(win.MCAutoSyncRuntimeV4.syncNow(),/HTTP 503/);
 assert.equal(timers.size,1);
 assert.equal([...timers.values()][0].ms,5000);
 await win.MCAutoSyncRuntimeV4.uploadQueued();
 assert.equal(push,1);
 assert.equal(timers.size,1,'push ACK must preserve failed full reconciliation retry');
 const [id,t]=[...timers.entries()][0];timers.delete(id);t.fn();
 for(let i=0;i<16;i++)await Promise.resolve();
 assert.equal(full,2,'remote changes must still be recovered');
 assert.equal(timers.size,0);
});

test('pending outbox without ACK backs off instead of polling every 1.5 seconds',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const timers=new Map();let seq=0,attempts=0;
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  uploadQueued:async()=>{attempts++;return {pending:1,uploaded:0,conflicts:[]}},
  syncNow:async()=>({sent:{pending:0,conflicts:[]},received:{downloaded:0}}),
  pull:async()=>({downloaded:0})
 },dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 await win.MCAutoSyncRuntimeV4.uploadQueued();
 for(const delay of [5000,10000,20000]){
  assert.equal(timers.size,1);
  const [id,t]=[...timers.entries()][0];
  assert.equal(t.ms,delay);
  timers.delete(id);t.fn();
  for(let i=0;i<16;i++)await Promise.resolve();
 }
 assert.equal(attempts,4);
 assert.equal([...timers.values()][0].ms,40000);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().pending,1);
});

test('HTTP 408 and 425 are classified as transient without enabling release',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 assert.equal((source.match(/HTTP 408/g)||[]).length,2);
 assert.equal((source.match(/HTTP 425/g)||[]).length,2);
 assert.match(source,/if\(errors\.length&&!retryable\)return/);
});

test('HTTP 408 and 425 transport rejections retry safely; CAS 409 does not',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 for(const status of [408,425,409]){
  const timers=new Map();let seq=0,attempts=0;
  const win={MCAutoCoversV4:{},MCAutoSyncV4:{
   uploadQueued:async()=>{attempts++;throw Error('HTTP '+status)},
   syncNow:async()=>({sent:{pending:0,conflicts:[]},received:{downloaded:0}}),
   pull:async()=>({downloaded:0})
  },dispatchEvent:()=>{}};
  const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
   CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
   console,Promise,Date,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},
   clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
  await assert.rejects(win.MCAutoSyncRuntimeV4.uploadQueued(),new RegExp('HTTP '+status));
  assert.equal(attempts,1);
  assert.equal(timers.size,status===409?0:1,'only transient transport errors schedule retries');
  if(status!==409)assert.equal([...timers.values()][0].ms,5000);
 }
});

test('Safari Load failed is retryable without enabling the production gate',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const timers=new Map();let next=0,attempts=0;
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  uploadQueued:async()=>{attempts++;if(attempts===1)throw Error('Load failed');return {pending:0,uploaded:1,conflicts:[]}},
  syncNow:async()=>({sent:{pending:0,conflicts:[]},received:{downloaded:0}}),
  pull:async()=>({downloaded:0})
 },dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id},
  clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 await assert.rejects(win.MCAutoSyncRuntimeV4.uploadQueued(),/Load failed/);
 assert.equal(timers.size,1);
 const [id,retry]=[...timers.entries()][0];
 assert.equal(retry.ms,5000);
 timers.delete(id);retry.fn();
 for(let i=0;i<16;i++)await Promise.resolve();
 assert.equal(attempts,2);
 assert.equal(timers.size,0);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().pending,0);
});


test('in-flight V4 reconciliation rejects a switched account rather than reusing its job',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const other='22222222-2222-4222-8222-222222222222';
 let release;const held=new Promise(resolve=>{release=resolve});
 let calls=0;
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  syncNow:async()=>{calls++;await held;return {sent:{pending:0,conflicts:[]},received:{downloaded:0,conflicts:[]}}},
  uploadQueued:async()=>{calls++},pull:async()=>{calls++}
 },dispatchEvent:()=>{}};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout,clearTimeout};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 const initial=win.MCAutoSyncRuntimeV4.syncNow();
 await Promise.resolve();
 ctx.MC_ACCOUNT_ID=other;ctx.DBN='comicteca-user-'+other;
 await assert.rejects(win.MCAutoSyncRuntimeV4.uploadQueued(),/Cambio de cuenta durante sincronización/);
 assert.equal(calls,1,'no cross-account transport request');
 release();await initial;
});

test('an in-flight result from a previous UID cannot update the new account status',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const first='11111111-1111-4111-8111-111111111111';
 const second='22222222-2222-4222-8222-222222222222';
 let finish;
 const pending=new Promise(resolve=>{finish=resolve});
 const emitted=[];
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{
  syncNow:async()=>pending,
  pull:async()=>({downloaded:0}),
  uploadQueued:async()=>({pending:0,uploaded:0,conflicts:[]})
 },dispatchEvent:event=>emitted.push(event)};
 const ctx={window:win,db:{},DBN:'comicteca-user-'+first,MC_ACCOUNT_ID:first,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout,clearTimeout};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 const job=win.MCAutoSyncRuntimeV4.syncNow();
 await Promise.resolve();
 ctx.MC_ACCOUNT_ID=second;
 ctx.DBN='comicteca-user-'+second;
 ctx.db={};
 finish({sent:{pending:0,uploaded:1,conflicts:[]},received:{downloaded:5,conflicts:[]}});
 await assert.rejects(job,/Cambio de cuenta durante sincronización; resultado descartado/);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().lastSuccessful,null);
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().lastDownloads,0);
 assert.equal(emitted.filter(e=>e.type==='mc-catalog-cloud-merged').length,0);
});


test('late network failure from previous UID cannot schedule retry or publish error for new account',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../sync-auto-runtime-v4.js'),'utf8');
 assert.match(source,/const RELEASE_APPROVED=false/);
 const enabled=source.replace('const RELEASE_APPROVED=false','const RELEASE_APPROVED=true');
 const uid='11111111-1111-4111-8111-111111111111';
 const other='22222222-2222-4222-8222-222222222222';
 let rejectOld;const pending=new Promise((_,reject)=>{rejectOld=reject});
 const timers=[];const dbA={};const dbB={};
 const win={MCAutoCoversV4:{},MCAutoSyncV4:{uploadQueued:()=>pending},dispatchEvent:()=>{}};
 const ctx={window:win,db:dbA,DBN:'comicteca-user-'+uid,MC_ACCOUNT_ID:uid,MC_IMPORT_TEST:false,
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}},
  console,Promise,Date,setTimeout:(fn,ms)=>{timers.push(ms);return timers.length},clearTimeout:()=>{}};
 vm.runInNewContext(enabled,ctx,{filename:'sync-auto-runtime-v4.js'});
 const oldJob=win.MCAutoSyncRuntimeV4.uploadQueued();
 ctx.MC_ACCOUNT_ID=other;ctx.DBN='comicteca-user-'+other;ctx.db=dbB;
 rejectOld(Error('HTTP 503'));
 await assert.rejects(oldJob,/HTTP 503/);
 assert.equal(timers.length,0,'old UID must not schedule retries for the new account');
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().lastError,null,'old UID error must not leak into new account status');
});
