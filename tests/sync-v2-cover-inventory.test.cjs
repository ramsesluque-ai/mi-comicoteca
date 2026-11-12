'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {coverKey,localKeys,remoteKeys,compare}=require('../sync-v2-cover-inventory.js');
const uid='00000000-0000-4000-8000-000000000001';
const cfg={url:'https://project.supabase.co',publishableKey:'public-test-key'};
const session={access_token:'test',user:{id:uid}};
function cache(local){
 return {open:async(name)=>{
   assert.equal(name,'mi-comicoteca-cover-vault-v1');
   return {keys:async()=>local.map(k=>({url:'https://mi-comicoteca.local/cover/'+encodeURIComponent(k)}))};
 }};
}
function list(names,{denied=false,badName=false,duplicate=false}={}){
 const calls=[];
 return {calls,fetcher:async(url,init)=>{
  assert.equal(url,'https://project.supabase.co/storage/v1/object/list/user-covers');
  assert.equal(init.method,'POST'); // LIST endpoint, no object writes
  assert.equal(init.headers.Authorization,'Bearer test');
  const body=JSON.parse(init.body);
  assert.equal(body.prefix,uid+'/');
  assert(body.offset>=0);
  calls.push(body);
  if(denied)return {ok:false,status:403};
  const page=names.slice(body.offset,body.offset+body.limit).map(name=>({name}));
  if(badName&&page.length)page[0].name='../not-owned';
  if(duplicate&&body.offset&&page.length)page[0].name=names[0];
  return {ok:true,json:async()=>page};
 }};
}
(async()=>{
 assert.equal(coverKey('https://mi-comicteca.local/cover/a'),null);
 assert.equal(coverKey('https://mi-comicoteca.local/cover/id123'),'id123');
 assert.deepEqual([...await localKeys({cacheStorage:cache(['one','two'])})],['one','two']);
 const r=list(['two','three','four','five']);
 const summary=await compare({session,cfg,cacheStorage:cache(['one','two']),fetcher:r.fetcher,limit:2});
 assert.deepEqual([summary.local,summary.remote,summary.matched,summary.onlyLocal,summary.onlyRemote,summary.safeToWrite],[2,4,1,1,3,false]);
 assert.equal(r.calls.length,3);assert.equal(r.calls[0].offset,0);assert.equal(r.calls[1].offset,2);
 await assert.rejects(remoteKeys({session,cfg,fetcher:list(['one'],{denied:true}).fetcher}),/HTTP 403/);
 await assert.rejects(remoteKeys({session,cfg,fetcher:list(['one'],{badName:true}).fetcher}),/inválido/);
 const source=fs.readFileSync('sync-v2-cover-inventory.js','utf8');
 assert(!/\/storage\/v1\/object\/user-covers/.test(source),'must not call upload endpoint');
 assert(!/method:'(?:PUT|PATCH|DELETE)'/.test(source),'no destructive cover writes');
 assert(fs.readFileSync('index.html','utf8').includes('sync-v2-cover-inventory.js'));
 console.log('SYNC_V2_COVER_INVENTORY_PASS local, remote, pagination, isolation, fail-closed');
})().catch(e=>{console.error(e);process.exitCode=1});
