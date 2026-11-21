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
 // Avoid startup scheduling: invoke the explicit API directly.
 for(let n=0;n<3;n++){
  await win.MCAutoSyncRuntimeV4.uploadQueued();
  if(n<2){
   assert.equal(timers.size,1,'a transient failure schedules exactly one retry');
   const entry=[...timers.entries()][0];
   assert.equal(entry[1].ms,n===0?5000:10000);
   timers.delete(entry[0]); // isolate each call without invoking background callbacks
  }
 }
 assert.equal(uploads,3);
 assert.equal(timers.size,0,'CAS conflicts must not trigger a busy retry loop');
 assert.equal(win.MCAutoSyncRuntimeV4.getStatus().lastConflicts,1);
});
