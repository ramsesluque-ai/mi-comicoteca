'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {canonical,localIndex}=require('../sync-v2-manual-plan.js');

test('Sync V2 rejects getters without evaluating them',()=>{
 let calls=0;
 const row={id:'safe'};
 Object.defineProperty(row,'title',{enumerable:true,get(){calls++;throw Error('getter executed')}});
 assert.throws(()=>canonical(row),/getter\/setter/);
 assert.equal(calls,0);
 assert.throws(()=>localIndex([row]),/getter\/setter/);
 assert.equal(calls,0);
});
test('Sync V2 rejects symbol fields rather than hashing incomplete records',()=>{
 const row={id:'safe',title:'A'};
 row[Symbol('secret')]='B';
 assert.throws(()=>canonical(row),/Symbol/);
});
test('Sync V2 still compares ordinary records deterministically',()=>{
 assert.equal(canonical({id:'1',title:'A'}),canonical({title:'A',id:'1'}));
 assert.equal(localIndex([{id:'1',title:'A'}]).size,1);
});
