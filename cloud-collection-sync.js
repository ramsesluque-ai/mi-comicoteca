'use strict';
/* COMICTECA cross-device sync v1: additive first migration, per-account RLS.
   Never clears local IndexedDB or sends an empty collection as a deletion. */
(function(){
 const SESSION='mc_supabase_session_v1', STORES=['comics','purchases','master'];
 let ready=false, running=false, suspended=false, pending=new Map(), timer=null, lastError='';
 const cfg=()=>window.MI_COMICOTECA_CLOUD||{};
 const session=()=>{try{return JSON.parse(sessionStorage.getItem(SESSION)||'null')}catch{return null}};
 const localId=(store,id)=>store+':'+String(id);
 const status=x=>x==='In Collection'?'owned':x==='On Wish List'?'wishlist':'pending';
 async function credentials(){
   let s=session();if(!s?.access_token||!s?.user?.id)return null;
   if(s.expires_at&&s.expires_at*1000<Date.now()+120000&&s.refresh_token){
     const c=cfg(),r=await fetch(c.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:c.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token})});
     if(!r.ok)throw Error('Sesión caducada: vuelve a iniciar sesión');
     s=await r.json();sessionStorage.setItem(SESSION,JSON.stringify(s));
   }
   return s;
 }
 async function request(path,options={}){
   const s=await credentials();if(!s)throw Error('Inicia sesión para sincronizar');
   const c=cfg(),r=await fetch(c.url+'/rest/v1/'+path,{...options,headers:{apikey:c.publishableKey,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});
   if(!r.ok)throw Error('Supabase '+r.status+': '+(await r.text()).slice(0,180));
   if(r.status===204)return null;return r.json();
 }
 async function remoteRows(){
   const s=await credentials(),out=[];if(!s)return out;
   for(let offset=0;;offset+=500){
     const rows=await request('user_comics?select=id,user_id,local_id,metadata,status,updated_at&user_id=eq.'+encodeURIComponent(s.user.id)+'&order=created_at.asc&limit=500&offset='+offset);
     out.push(...rows);if(rows.length<500)break;
   }
   return out;
 }
 function asRemote(store,r,uid){return {user_id:uid,local_id:localId(store,r.id),status:store==='comics'?status(r.status):'pending',custom_title:String(r.title||r.catalogHeader||r.series||'').slice(0,500),metadata:{comicteca_sync_v:1,kind:store,record:r}}}
 async function insertMissing(store,r,uid){
   const body=asRemote(store,r,uid);
   // Unique (user_id,local_id) prevents duplicate migration across devices.
   await request('user_comics?on_conflict=user_id,local_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(body)});
 }
 async function updateOne(store,r){
   const s=await credentials();if(!s)return;
   const key=localId(store,r.id),body=asRemote(store,r,s.user.id);
   const existing=await request('user_comics?select=id&user_id=eq.'+s.user.id+'&local_id=eq.'+encodeURIComponent(key)+'&limit=1');
   if(existing.length)await request('user_comics?id=eq.'+existing[0].id+'&user_id=eq.'+s.user.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:body.status,custom_title:body.custom_title,metadata:body.metadata,updated_at:new Date().toISOString()})});
   else await insertMissing(store,r,s.user.id);
 }
 async function synchronize(){
   if(running||!db)return;running=true;
   try{
     const s=await credentials();if(!s)return;
     const cloud=await remoteRows(),remote=new Map(cloud.filter(x=>x.local_id&&x.metadata?.record).map(x=>[x.local_id,x]));
     const local={};for(const store of STORES)local[store]=await allStore(store);
     suspended=true;
     let downloaded=0,uploaded=0;
     for(const item of cloud){
       const kind=item.metadata?.kind,record=item.metadata?.record;
       if(!STORES.includes(kind)||!record?.id||item.user_id!==s.user.id)continue;
       if(!(await getStore(kind,record.id))){await putStore(kind,record);downloaded++}
     }
     suspended=false;
     for(const store of STORES)for(const record of local[store]){
       if(!record?.id)continue;
       if(!remote.has(localId(store,record.id))){await insertMissing(store,record,s.user.id);uploaded++}
     }
     ready=true;lastError='';
     if(downloaded&&typeof render==='function')await render();
     console.info('COMICTECA sync', {downloaded,uploaded,remote:cloud.length});
     await flush();
   }catch(e){suspended=false;lastError=e.message||String(e);console.warn('COMICTECA sync paused; local data preserved:',e)}
   finally{running=false}
 }
 async function flush(){
   if(running||!ready||!pending.size)return;
   const entries=[...pending.entries()];pending.clear();
   for(const [key,item] of entries){try{await updateOne(item.store,item.record)}catch(e){pending.set(key,item);lastError=e.message||String(e);console.warn('COMICTECA pending sync',e);break}}
 }
 function queue(store,record){
   if(suspended||!STORES.includes(store)||!record?.id)return;
   pending.set(localId(store,record.id),{store,record});
   clearTimeout(timer);timer=setTimeout(()=>{if(ready)flush();else synchronize()},1300);
 }
 const originalPut=window.putStore;
 if(typeof originalPut==='function')window.putStore=async function(store,record){const result=await originalPut(store,record);queue(store,record);return result};
 const originalBulk=window.bulkPut;
 if(typeof originalBulk==='function')window.bulkPut=async function(store,rows){const result=await originalBulk(store,rows);for(const r of rows)queue(store,r);return result};
 window.ComictecaCloudSync={sync:synchronize,getStatus:()=>({ready,running,pending:pending.size,lastError})};
 window.addEventListener('load',()=>setTimeout(synchronize,1200));
 window.addEventListener('online',synchronize);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)synchronize()});
 setInterval(()=>{if(!document.hidden)synchronize()},120000);
})();
