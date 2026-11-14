'use strict';
// Run: node tests/sync-v2-tombstone-readonly.test.cjs
const assert=require('node:assert/strict');
const {compare}=require('../sync-v2-manual-plan.js');
const uid='11111111-1111-4111-8111-111111111111';
const session={access_token:'isolated-test-token',user:{id:uid}};
const cfg={url:'https://fake.invalid',publishableKey:'fake'};
const localRows=[{id:1,title:'Preserved locally'},{id:2,title:'Local only'}];
let calls=[];
const fetcher=async(url,opts)=>{
 calls.push({url,method:opts.method});
 if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:uid})};
 if(url.includes('/rest/v1/user_comics'))return {ok:true,json:async()=>[
 {user_id:uid,local_id:'comics:1',metadata:{kind:'comics',deleted:true,deletedAt:'2026-11-14T08:00:00Z'}}
 ]};
 throw Error('Unexpected request');
};
compare({session,cfg,localRows,fetcher}).then(stats=>{
 assert.equal(stats.tombstones,1);
 assert.equal(stats.onlyLocal,1,'tombstoned cloud ID must not be counted as only local');
 assert.equal(stats.cloud,0);
 assert.equal(stats.safeToWrite,false);
 assert.equal(stats.readOnly,true);
 assert(calls.every(c=>c.method==='GET'));
 console.log('PASS: tombstone is counted as seen; no writes; no upload permission');
}).catch(e=>{console.error(e);process.exitCode=1});
