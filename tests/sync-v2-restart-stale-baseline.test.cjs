'use strict';
// Isolated crash/restart regression. No real users, IndexedDB or Supabase writes.
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const cp=require('../sync-v2-checkpoint.js');
require('../sync-v2-reconcile.js');
const uid='33333333-3333-4333-8333-333333333333';
const cryptoImpl=webcrypto;
const base=[{id:'stable-1',publisher:'Test',series:'Demo',issue:'1',title:'Original',notes:'initial',coverKey:'private-1'}];
(async()=>{
 const hash=await cp.digestRows(base,{cryptoImpl});
 const checkpoint=await cp.create({uid,rows:base,remoteSnapshotHash:hash,cryptoImpl});
 // Device B restarts with a persisted, still valid baseline. Device A has edited the cloud.
 const remote=[{...base[0],notes:'edited on device A'}];
 const remoteHash=await cp.digestRows(remote,{cryptoImpl});
 const staleLocal=[{...base[0],notes:'edited offline on device B'}];
 const conflict=await cp.plan({uid,checkpoint,localRows:staleLocal,remoteRows:remote,remoteSnapshotHash:remoteHash,cryptoImpl});
 assert.equal(conflict.baselineVerified,true);
 assert.equal(conflict.writeAuthorized,false);
 assert.ok(conflict.conflicts.length>0,'offline concurrent edits must conflict');
 assert.equal(conflict.upload.length+conflict.download.length+conflict.merged.length,0);
 // A missing local record is not permission to delete it remotely.
 const missing=await cp.plan({uid,checkpoint,localRows:[],remoteRows:remote,remoteSnapshotHash:remoteHash,cryptoImpl});
 assert.equal(missing.writeAuthorized,false);
 assert.ok(missing.conflicts.length>0);
 assert.equal(missing.upload.length+missing.download.length+missing.merged.length,0);
 // A lost checkpoint must not be silently replaced with an empty baseline.
 await assert.rejects(cp.plan({uid,checkpoint:undefined,localRows:staleLocal,remoteRows:remote,remoteSnapshotHash:remoteHash,cryptoImpl}),/Baseline ausente/);
 // A changed cover reference, even on both sides, requires separate binary verification.
 const sameCover=[{...base[0],coverKey:'private-2'}];
 const sameCoverHash=await cp.digestRows(sameCover,{cryptoImpl});
 const cover=await cp.plan({uid,checkpoint,localRows:sameCover,remoteRows:sameCover,remoteSnapshotHash:sameCoverHash,cryptoImpl});
 assert.equal(cover.writeAuthorized,false);
 assert.ok(cover.conflicts.length>0,'matching cover references do not prove matching bytes');
 assert.equal(cover.upload.length+cover.download.length+cover.merged.length,0);
 console.log('PASS restart stale baseline, missing records, absent checkpoint, unverified cover refs; no writes');
})().catch(e=>{console.error(e);process.exitCode=1});
