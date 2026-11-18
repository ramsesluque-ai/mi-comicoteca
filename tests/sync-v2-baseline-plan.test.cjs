'use strict';
const assert=require('node:assert/strict');
const {plan}=require('../sync-v2-baseline-plan.js');
const a=(id,title)=>({id,title,coverKey:'private:keep'});
const base=[a(1,'old')];
assert.deepEqual(plan({local:base,remote:base,baseline:base}).identical,['1']);
assert.deepEqual(plan({local:base,remote:[a(1,'new')],baseline:base}).download,['1']);
assert.deepEqual(plan({local:[a(1,'new')],remote:base,baseline:base}).upload,['1']);
assert.equal(plan({local:[a(1,'local')],remote:[a(1,'remote')],baseline:base}).conflicts[0].reason,'concurrent-edits');
assert.equal(plan({local:[],remote:base,baseline:base}).conflicts[0].reason,'missing-without-tombstone');
assert.deepEqual(plan({local:[a(2,'new')],remote:[],baseline:[]}).untracked,['2']);
assert.deepEqual(plan({local:base,remote:base,baseline:base,tombstones:[{id:1,explicit:true,baseHash:'abc'}]}).deletionsBlocked,['1']);
assert.throws(()=>plan({local:base,remote:base,baseline:base,tombstones:[{id:1}]}));
assert.throws(()=>plan({local:[a(1,'a'),a(1,'b')],remote:[],baseline:[]}));
assert.equal(plan({local:[{...a(1,'old'),coverKey:'private:local'}],remote:base,baseline:base}).conflicts[0].reason,'cover-reference-changed');
assert.equal(plan({local:base,remote:[{...a(1,'old'),coverUrl:'https://example.test/cover.png'}],baseline:base}).conflicts[0].reason,'cover-reference-changed');
assert.equal(plan({local:[{...a(1,'local'),coverKey:'private:local'}],remote:[{...a(1,'remote'),coverKey:'private:remote'}],baseline:base}).conflicts[0].reason,'cover-reference-changed');
assert.deepEqual(plan({local:[a(1,'local')],remote:base,baseline:base}).upload,['1']);
assert.equal(plan({local:base,remote:base,baseline:base}).safeToExecute,false);
const mixed=plan({local:[a(1,'local'),a(2,'new'),a(3,'local')],remote:[a(1,'old'),a(3,'remote')],baseline:[a(1,'old'),a(3,'old')]});
assert.equal(mixed.conflicts[0].reason,'concurrent-edits');
assert.deepEqual(mixed.untracked,['2']);
assert.deepEqual(mixed.upload,[],'no partial uploads with unresolved conflict');
assert.deepEqual(mixed.download,[],'no partial downloads with unresolved conflict');
const untracked=plan({local:[a(1,'new'),a(2,'new')],remote:[a(1,'old')],baseline:[a(1,'old')]});
assert.deepEqual(untracked.upload,[],'untracked records block otherwise valid upload');
assert.equal(plan({local:[{...a(1,'old'),coverSourceUrl:'https://example.test/a'}],remote:base,baseline:base}).conflicts[0].reason,'cover-reference-changed');
assert.equal(plan({local:base,remote:[{...a(1,'old'),coverUrls:['https://example.test/a']}],baseline:base}).conflicts[0].reason,'cover-reference-changed');

const bothChanged=[{...a(1,'old'),coverKey:'private:new'}];
assert.equal(plan({local:bothChanged,remote:bothChanged,baseline:base}).conflicts[0].reason,'cover-reference-changed-since-baseline','matching metadata cannot certify binary cover transfer');
const protectedMixed=plan({local:[...bothChanged,a(2,'edited')],remote:[...bothChanged,a(2,'old')],baseline:[...base,a(2,'old')]});
assert.deepEqual(protectedMixed.upload,[],'unverified cover change blocks unrelated upload batch');

// Reject IDs whose string coercion would silently alias unrelated records.
for(const invalidId of [null,undefined,{},[],true,1.5,NaN,Infinity,-1,Number.MAX_SAFE_INTEGER+1,' 1 ','']) {
 assert.throws(()=>plan({local:[{...a(1,'old'),id:invalidId}],remote:[],baseline:[]}),/invalid stable ID/);
}
assert.throws(()=>plan({local:[a(1,'old'),{...a(1,'old'),id:'1'}],remote:[],baseline:[]}),/duplicate stable ID/);
assert.deepEqual(plan({local:[{...a(1,'old'),id:'comics:1'}],remote:[],baseline:[]}).untracked,['comics:1']);
console.log('Sync V2 baseline safety: ID validation and reconciliation assertions passed');

for(const field of ['coverHash','coverSha256','coverSHA256','coverDigest','coverMime','coverSize']){
 const changed={...a(1,'old'),[field]:field==='coverSize'?123:'changed'};
 assert.equal(plan({local:[changed],remote:base,baseline:base}).conflicts[0].reason,'cover-reference-changed',field+' cannot be merged as ordinary metadata');
 assert.equal(plan({local:[changed],remote:[changed],baseline:base}).conflicts[0].reason,'cover-reference-changed-since-baseline',field+' matching manifests do not verify binary transfer');
}

const matchingUntracked=plan({local:[a('shared-new','same')],remote:[a('shared-new','same')],baseline:[]});
assert.deepEqual(matchingUntracked.untracked,['shared-new'],'matching rows without a baseline cannot be certified as reconciled');
assert.deepEqual(matchingUntracked.identical,[],'untracked matching rows must not appear as baseline-verified');
const mixedMatchingUntracked=plan({local:[a(1,'local'),a(2,'same')],remote:[a(1,'old'),a(2,'same')],baseline:[a(1,'old')]});
assert.deepEqual(mixedMatchingUntracked.untracked,['2']);
assert.deepEqual(mixedMatchingUntracked.upload,[],'matching untracked rows must block unrelated proposed uploads');
assert.equal(mixedMatchingUntracked.safeToExecute,false);
