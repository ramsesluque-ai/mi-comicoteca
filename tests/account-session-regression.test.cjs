'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const KEY='mc_supabase_session_v1';
const UID='0bcbe06d-263d-4ac1-a516-355d27d417f1';
const billing=fs.readFileSync(path.join(root,'commercial-billing.js'),'utf8');
const app1=fs.readFileSync(path.join(root,'app1.js'),'utf8');
function storage(values={}){
 const entries=new Map(Object.entries(values));
 return {getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};
}
function session(access='OLD'){return {user:{id:UID},access_token:access,refresh_token:'REFRESH'};}
function isolatedBilling({persisted=null,tab=null,responder}){
 const localStorage=storage(persisted?{[KEY]:JSON.stringify(persisted)}:{});
 const sessionStorage=storage(tab?{[KEY]:JSON.stringify(tab)}:{});
 const listeners={};
 let reloads=0;
 class HeadersMock{
  constructor(o={}){this.headers={...o};}
  set(k,v){this.headers[k]=v;}
  get(k){return this.headers[k];}
 }
 const window={MI_COMICOTECA_CLOUD:{url:'https://test.invalid',publishableKey:'public'},addEventListener:(type,fn)=>listeners[type]=fn};
 const sandbox={window,document:{addEventListener(){}},location:{reload(){reloads++;}},localStorage,sessionStorage,Headers:HeadersMock,fetch:responder};
 vm.runInNewContext(billing,sandbox,{filename:'commercial-billing.js'});
 return {api:window.CommercialBilling,localStorage,sessionStorage,listeners,reloads:()=>reloads};
}
test('persisted account selects its IndexedDB namespace after a tab restart',()=>{
 const start=app1.indexOf('function mcAccountStorageId()');
 const end=app1.indexOf('const MC_ACCOUNT_ID');
 assert.ok(start>=0&&end>start);
 const selector=app1.slice(start,end);
 const sandbox={localStorage:storage({[KEY]:JSON.stringify(session())}),sessionStorage:storage()};
 vm.runInNewContext(selector+'; result=mcAccountStorageId()',sandbox);
 assert.equal(sandbox.result,UID);
});
test('401 refreshes tokens without changing user identity',async()=>{
 let calls=0;
 const responder=async(url,opt)=>{
  calls++;
  if(url.includes('grant_type=refresh_token'))return {ok:true,status:200,json:async()=>session('NEW')};
  if(url.endsWith('/auth/v1/user'))return opt.headers.get('Authorization')==='Bearer NEW'?{ok:true,status:200,json:async()=>({id:UID})}:{ok:false,status:401};
  throw Error('Unexpected endpoint');
 };
 const x=isolatedBilling({persisted:session(),responder});
 const user=await x.api.currentUser();
 assert.equal(user.id,UID);
 assert.equal(JSON.parse(x.localStorage.getItem(KEY)).access_token,'NEW');
 assert.equal(JSON.parse(x.sessionStorage.getItem(KEY)).access_token,'NEW');
 assert.equal(calls,3);
});
test('temporary network failure does not erase account session',async()=>{
 const x=isolatedBilling({persisted:session(),responder:async()=>{throw Error('network down')}});
 await assert.rejects(()=>x.api.currentUser(),/network down/);
 assert.equal(JSON.parse(x.localStorage.getItem(KEY)).user.id,UID);
 assert.equal(JSON.parse(x.sessionStorage.getItem(KEY)).user.id,UID);
});
test('cross-tab sign out discards stale tab session and reloads',()=>{
 const x=isolatedBilling({persisted:session(),tab:session(),responder:async()=>{throw Error('unused')}});
 x.localStorage.removeItem(KEY);
 x.listeners.storage({key:KEY,newValue:null});
 assert.equal(x.sessionStorage.getItem(KEY),null);
 assert.equal(x.reloads(),1);
});
test('unexpected account identity during token refresh is rejected',async()=>{
 const other='f3a42ed3-9735-480e-baba-06bc32d36db5';
 const responder=async(url)=>{
  if(url.includes('grant_type=refresh_token'))return {ok:true,status:200,json:async()=>({...session('NEW'),user:{id:other}})};
  return {ok:false,status:401};
 };
 const x=isolatedBilling({persisted:session(),responder});
 await assert.rejects(()=>x.api.currentUser(),/identidad distinta/);
 assert.equal(JSON.parse(x.localStorage.getItem(KEY)).user.id,UID);
});
test('deployment HTML references new account and diagnostic versions',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const marker of ['app1.js?v=20261116-persistent-account','commercial-billing.js?v=20261116-singleflight-auth','account-storage-diagnostic.js?v=20261116-empty-recovery2'])assert.ok(html.includes(marker),marker);
});

test('simultaneous membership and collection checks refresh once',async()=>{
 let refreshCalls=0;
 const responder=async(url,opt)=>{
  if(url.includes('grant_type=refresh_token')){
   refreshCalls++;
   await Promise.resolve();
   return {ok:true,status:200,json:async()=>session('NEW')};
  }
  if(url.endsWith('/auth/v1/user')){
   return opt.headers.get('Authorization')==='Bearer NEW'
    ?{ok:true,status:200,json:async()=>({id:UID})}
    :{ok:false,status:401};
  }
  throw Error('Unexpected auth request');
 };
 const x=isolatedBilling({persisted:session(),responder});
 const users=await Promise.all([x.api.currentUser(),x.api.currentUser()]);
 assert.equal(users.length,2);
 assert.ok(users.every(user=>user.id===UID));
 assert.equal(refreshCalls,1);
});

test('Supabase 403 bad_jwt from an expired access token renews once',async()=>{
 let refreshed=0,authCalls=0;
 const responder=async(url,opt)=>{
  if(url.includes('grant_type=refresh_token')){
   refreshed++;
   return {ok:true,status:200,json:async()=>session('NEW')};
  }
  if(url.endsWith('/auth/v1/user')){
   authCalls++;
   return opt.headers.get('Authorization')==='Bearer NEW'
    ?{ok:true,status:200,json:async()=>({id:UID})}
    :{ok:false,status:403,headers:{get:()=> 'bad_jwt'}};
  }
  throw Error('Unexpected endpoint');
 };
 const x=isolatedBilling({persisted:session('OLD'),responder});
 const user=await x.api.currentUser();
 assert.equal(user.id,UID);
 assert.equal(refreshed,1);
 assert.equal(authCalls,2);
 assert.equal(JSON.parse(x.localStorage.getItem(KEY)).access_token,'NEW');
});
test('proactive token renewal avoids the 403 response entirely',async()=>{
 let authCalls=0,oldTokenPresented=false,refreshCalls=0;
 const expired={...session('OLD'),expires_at:Math.floor(Date.now()/1000)-60};
 const responder=async(url,opt)=>{
  if(url.includes('grant_type=refresh_token')){
   refreshCalls++;
   return {ok:true,status:200,json:async()=>({...session('NEW'),expires_at:Math.floor(Date.now()/1000)+3600})};
  }
  if(url.endsWith('/auth/v1/user')){
   authCalls++;
   oldTokenPresented=opt.headers.get('Authorization')==='Bearer OLD';
   return {ok:true,status:200,json:async()=>({id:UID})};
  }
  throw Error('Unexpected endpoint');
 };
 const x=isolatedBilling({persisted:expired,responder});
 const user=await x.api.currentUser();
 assert.equal(user.id,UID);
 assert.equal(authCalls,1);
 assert.equal(refreshCalls,1);
 assert.equal(oldTokenPresented,false);
});
test('a failed token renewal leaves the local identity/session intact for explicit sign-in',async()=>{
 const responder=async(url,opt)=>{
  if(url.includes('grant_type=refresh_token'))return {ok:false,status:400,json:async()=>({code:'refresh_token_not_found'})};
  return {ok:false,status:403};
 };
 const x=isolatedBilling({persisted:session('OLD'),responder});
 await assert.rejects(()=>x.api.currentUser(),/inicia sesión de nuevo/i);
 assert.equal(JSON.parse(x.localStorage.getItem(KEY)).user.id,UID);
 assert.equal(JSON.parse(x.sessionStorage.getItem(KEY)).user.id,UID);
});
