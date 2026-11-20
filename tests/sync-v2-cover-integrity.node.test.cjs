'use strict';
/* Isolated binary integrity regression tests. No Supabase credentials or owner data. */
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
const {Blob}=require('node:buffer');
const cover=require('../sync-v2-cover-integrity.js');
const blob=(value)=>new Blob([Buffer.from(value)]);
test('same bytes yield same SHA-256, independent of blob instance',async()=>{
 const a=blob('private-cover-test'),b=blob('private-cover-test');
 const r=await cover.verifyPair(a,b,{cryptoImpl:crypto});
 assert.equal(r.equal,true);
 assert.match(r.localSha256,/^[0-9a-f]{64}$/);
 assert.equal(r.localSha256,r.remoteSha256);
});
test('single byte alteration is detected, not compared by filename or length',async()=>{
 const r=await cover.verifyPair(blob('abc'),blob('abd'),{cryptoImpl:crypto});
 assert.equal(r.equal,false);
 assert.equal(r.localBytes,r.remoteBytes);
});
test('expected digest is validated and checked against binary content',async()=>{
 const original=blob('cover-a');
 const hash=await cover.sha256(original,{cryptoImpl:crypto});
 assert.equal((await cover.verifyExpected(original,hash,{cryptoImpl:crypto})).equal,true);
 assert.equal((await cover.verifyExpected(blob('cover-b'),hash,{cryptoImpl:crypto})).equal,false);
 await assert.rejects(cover.verifyExpected(original,'not-a-hash',{cryptoImpl:crypto}),/SHA-256/);
});
test('empty and oversized covers fail closed',async()=>{
 await assert.rejects(cover.sha256(blob(''),{cryptoImpl:crypto}),/Portada/);
 await assert.rejects(cover.sha256(blob('abc'),{cryptoImpl:crypto,maxBytes:2}),/Portada/);
});
test('unavailable digest fails closed',async()=>{
 await assert.rejects(cover.sha256(blob('abc'),{cryptoImpl:{}}),/SHA-256/);
});
