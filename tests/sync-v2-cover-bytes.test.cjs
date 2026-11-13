'use strict';
// Read-only private cover SHA-256 audit: only mocked Storage and CacheStorage.
const assert=require('node:assert/strict');
const inv=require('../sync-v2-cover-inventory.js');
const integrity=require('../sync-v2-cover-integrity.js');
const uid='11111111-1111-4111-8111-111111111111';
const cfg={url:'https://fake.test',publishableKey:'public'};
const session={user:{id:uid},access_token:'test'};
const blob=text=>new Blob([text],{type:'image/webp'});
const local=new Map([['same',blob('identical bytes')],['different',blob('local bytes')],['extra',blob('untracked local')]]);
const remote=new Map([['same',blob('identical bytes')],['different',blob('remote bytes')],['new',blob('cloud only')]]);
const calls=[],cacheStorage={open:async name=>{
 assert.equal(name,'mi-comicoteca-cover-vault-v1');
 return {
   keys:async()=>[...local].map(([k])=>({url:'https://mi-comicoteca.local/cover/'+encodeURIComponent(k)})),
   match:async url=>{const key=decodeURIComponent(new URL(url).pathname.split('/').pop());return local.has(key)?new Response(local.get(key),{headers:{'Content-Type':'image/webp'}}):undefined}
 };
}};
let forbidden=false,badUser=false;
const fetcher=async(url,opts)=>{
 calls.push({method:opts.method,url});
 assert(['GET','POST'].includes(opts.method));
 if(url.endsWith('/auth/v1/user'))
   return {ok:!forbidden,status:forbidden?403:200,json:async()=>({id:badUser?'22222222-2222-4222-8222-222222222222':uid})};
 if(url.endsWith('/object/list/user-covers')){
   assert.equal(opts.method,'POST');
   assert.equal(JSON.parse(opts.body).prefix,uid+'/');
   return {ok:!forbidden,status:forbidden?403:200,json:async()=>[...remote].map(([name])=>({name}))};
 }
 assert(url.includes('/storage/v1/object/user-covers/'+uid+'/'));
 if(forbidden)return {ok:false,status:403};
 const key=decodeURIComponent(new URL(url).pathname.split('/').pop());
 return remote.has(key)?{ok:true,status:200,blob:async()=>remote.get(key)}:{ok:false,status:404};
};
(async()=>{
 const args={session,cfg,fetcher,cacheStorage,integrity};
 const res=await inv.compareBytes(args);
 assert.deepEqual([res.totalMatched,res.checked,res.identical,res.different,res.remaining,res.complete,res.safeToWrite],[2,2,1,1,0,true,false]);
 const partial=await inv.compareBytes({...args,maxCheck:1});
 assert.deepEqual([partial.checked,partial.remaining,partial.complete],[1,1,false]);
 assert.equal(calls.filter(x=>x.url.includes('/storage/v1/object/user-covers/'+uid+'/')).length,3);
 assert(calls.every(x=>!['PUT','PATCH','DELETE'].includes(x.method)));
 assert(!calls.some(x=>x.url.includes('master-covers')||x.url.includes('/rest/v1/')));
 forbidden=true;
 await assert.rejects(inv.compareBytes(args),/403/);
 forbidden=false;badUser=true;
 await assert.rejects(inv.compareBytes(args),/identidad autenticada/);
 badUser=false;
 const corrupted=blob('');
 remote.set('same',corrupted);
 await assert.rejects(inv.compareBytes(args),/vacía|grande/);
 console.log('PASS private cover read-only binary audit: matching, mismatch, partial, denied, wrong user, corruption, zero writes');
})().catch(e=>{console.error(e);process.exitCode=1});
