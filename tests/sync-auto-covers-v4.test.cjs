'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
globalThis.crypto=webcrypto;
globalThis.MCSyncV2CoverIntegrity=require('../sync-v2-cover-integrity.js');
const covers=require('../sync-auto-covers-v4.js');
const uid='11111111-1111-4111-8111-111111111111';
const foreign='22222222-2222-4222-8222-222222222222';
const record={id:'c_1',coverKey:'c_1',title:'Private comic'};
const cfg={url:'https://example.supabase.co',publishableKey:'pk'};
const session={user:{id:uid},access_token:'test-user-token'};
const blob=bytes=>new Blob([Uint8Array.from(bytes)],{type:'image/jpeg'});
const image=()=>blob([255,216,255,217]);
function makeCaches(){
 const stores=new Map();
 return {stores,async open(name){
  if(!stores.has(name))stores.set(name,new Map());
  const map=stores.get(name);
  return {match:async url=>map.get(String(url))?.clone(),put:async (url,response)=>{map.set(String(url),response.clone())}};
 }};
}
function backend(){
 let remote=null,uploads=0;
 return {
  get uploads(){return uploads},
  get remote(){return remote},
  set remote(value){remote=value},
  async fetcher(url,opts){
   if(opts.method==='GET')return remote?new Response(remote,{status:200}):new Response('Not found',{status:404});
   if(opts.method==='POST'){
    assert.match(url,/\/storage\/v1\/object\/user-covers\/11111111-/);
    assert.equal(opts.headers['x-upsert'],'false');
    if(remote)return new Response('Duplicate',{status:409});
    uploads++;remote=opts.body;return new Response('{}',{status:200});
   }
   throw Error('Unexpected method');
  }
 };
}
test('private cover is uploaded, fetched again and SHA-256 verified',async()=>{
 globalThis.MC_ACCOUNT_ID=uid;
 globalThis.getStore=async()=>record;
 globalThis.caches=makeCaches();
 const cloud=backend();
 await covers.putCache(uid,'c_1',image());
 const upload=await covers.upload({record,uid,session,cfg,fetcher:cloud.fetcher});
 assert.equal(upload.verified,true);
 assert.equal(cloud.uploads,1);
 assert.equal((await covers.download({record,uid,session,cfg,fetcher:cloud.fetcher})).verified,true);
 const repeated=await covers.upload({record,uid,session,cfg,fetcher:cloud.fetcher});
 assert.equal(repeated.verified,true);
 assert.equal(cloud.uploads,1);
});
test('a second device recovers the exact private image without upload',async()=>{
 globalThis.MC_ACCOUNT_ID=uid;
 globalThis.getStore=async()=>record;
 const cloud=backend();cloud.remote=image();
 globalThis.caches=makeCaches();
 const result=await covers.download({record,uid,session,cfg,fetcher:cloud.fetcher});
 assert.equal(result.downloaded,true);
 assert.equal(result.verified,true);
 const cached=await covers.fromCache(uid,'c_1');
 assert.equal(cached.size,4);
});
test('a different user cannot reuse the same session or cache namespace',async()=>{
 globalThis.MC_ACCOUNT_ID=uid;
 const cloud=backend();cloud.remote=image();
 await assert.rejects(covers.download({record,uid:foreign,session,cfg,fetcher:cloud.fetcher}),/sesión|cuenta/i);
 assert.notEqual(covers.cacheName(uid),covers.cacheName(foreign));
});
test('changed bytes of a cloud cover cannot silently replace the local image',async()=>{
 globalThis.MC_ACCOUNT_ID=uid;
 const cloud=backend();cloud.remote=blob([255,216,255,218]);
 globalThis.caches=makeCaches();
 await covers.putCache(uid,'c_1',image());
 await assert.rejects(covers.download({record,uid,session,cfg,fetcher:cloud.fetcher}),/Conflicto/);
});

test('user-saved HTTPS cover links can be backed up as SHA-verified private bytes',async()=>{
 globalThis.MC_ACCOUNT_ID=uid;
 globalThis.caches=makeCaches();
 globalThis.CoverVault={fetchAndCompress:async link=>{
  assert.equal(link,'https://publisher.example.com/cover.jpg');
  return image();
 }};
 const item={id:'c_1',title:'Linked cover',coverUrl:'https://publisher.example.com/cover.jpg'};
 const saved=await covers.prepareLinked({record:item,uid,session,cfg});
 assert.equal(saved.id,item.id);
 assert.equal(saved.coverSourceUrl,item.coverUrl);
 assert.match(saved.coverSha256,/^[a-f0-9]{64}$/);
 assert.match(saved.coverKey,/^c_1-[a-f0-9]{20}$/);
 assert.equal(saved.coverSyncPending,true);
 assert.equal((await covers.fromCache(uid,saved.coverKey)).size,4);
});
test('non-HTTPS cover links cannot become private uploads',async()=>{
 globalThis.MC_ACCOUNT_ID=uid;
 globalThis.CoverVault={fetchAndCompress:async()=>{throw Error('should not fetch')}};
 await assert.rejects(covers.prepareLinked({record:{id:'c_1',coverUrl:'http://bad.example/cover.jpg'},uid,session,cfg}),/HTTPS/);
});
