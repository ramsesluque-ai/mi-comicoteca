'use strict';
// Isolated production guard: URL opt-in must not bypass the disabled owner migration.
// No browser, Supabase credentials, owner records or network access.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
(async()=>{
 for(const [file,query] of [
   ['sync-v2-owner-upload.js','?syncv2=subida'],
   ['sync-v2-owner-receive.js','?syncv2=recepcion']
 ]){
   const counters={network:0,db:0,dom:0};
   const fail=(kind)=>()=>{counters[kind]++;throw Error('Unexpected '+kind+' access');};
   const sandbox={
     URLSearchParams,location:{search:query},
     sessionStorage:{getItem:fail('db')},
     localStorage:{getItem:fail('db')},
     document:{createElement:fail('dom')},
     fetch:fail('network'),
     allStore:fail('db'),
     getStore:fail('db'),
     putStore:fail('db'),
     delStore:fail('db'),
     console:{info(){}}
   };
   vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file,timeout:1000});
   // An async IIFE returns immediately at its initial fail-closed gate.
   await Promise.resolve();
   assert.deepEqual(counters,{network:0,db:0,dom:0},file+' must remain inert');
 }
 console.log('PASS owner upload/receive URL opt-ins cannot bypass fail-closed write gate');
})().catch(error=>{console.error(error);process.exitCode=1});
