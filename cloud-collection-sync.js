'use strict';
/* COMICTECA cross-device sync v1: additive first migration, per-account RLS.
   Never clears local IndexedDB or sends an empty collection as a deletion. */
(function(){
 const SESSION='mc_supabase_session_v1', STORES=['comics','purchases'];
 const deletedKey=uid=>'mc_cloud_deleted_'+uid;
 const deletedSet=uid=>{try{return new Set(JSON.parse(localStorage.getItem(deletedKey(uid))||'[]'))}catch{return new Set()}};
 const rememberDeleted=(uid,key)=>{const s=deletedSet(uid);s.add(key);localStorage.setItem(deletedKey(uid),JSON.stringify([...s]))};
 let ready=false, running=false, suspended=false, pending=new Map(), timer=null, lastError='';
 const cfg=()=>window.MI_COMICOTECA_CLOUD||{};
 const session=()=>{try{return JSON.parse(sessionStorage.getItem(SESSION)||'null')}catch{return null}};
 const localId=(store,id)=>store+':'+String(id);
 // Conservative reconciliation: match edition and issue, never just character/title.
 // Ambiguous or unnumbered entries are not merged or removed automatically.
 const issueIdentity=(store,x)=>{
   if(store!=='comics'||!x)return '';
   const issue=String(x.issueNr??x.issue??x.number??'').trim().toLocaleLowerCase('es');
   if(!issue)return '';
   const key=typeof ckey==='function'?ckey(x):'';
   return key&&key.split('|').join('').trim()?key+'|'+issue:'';
 };
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
 async function markDeleted(store,id){
   const s=await credentials();if(!s)return;
   const key=localId(store,id);
   rememberDeleted(s.user.id,key);
   const rows=await request('user_comics?select=id,metadata&user_id=eq.'+encodeURIComponent(s.user.id)+'&local_id=eq.'+encodeURIComponent(key)+'&limit=1');
   if(rows.length){
     const metadata={...(rows[0].metadata||{}),deleted:true,deleted_at:new Date().toISOString()};
     await request('user_comics?id=eq.'+encodeURIComponent(rows[0].id)+'&user_id=eq.'+encodeURIComponent(s.user.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({metadata,updated_at:new Date().toISOString()})});
   }else{
     await request('user_comics?on_conflict=user_id,local_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({user_id:s.user.id,local_id:key,status:'pending',custom_title:'',metadata:{comicteca_sync_v:1,kind:store,deleted:true,deleted_at:new Date().toISOString()}})});
   }
 }
 async function updateOne(store,r){
   const s=await credentials();if(!s)return;
   const key=localId(store,r.id),body=asRemote(store,r,s.user.id);
   const existing=await request('user_comics?select=id&user_id=eq.'+s.user.id+'&local_id=eq.'+encodeURIComponent(key)+'&limit=1');
   if(existing.length)await request('user_comics?id=eq.'+existing[0].id+'&user_id=eq.'+s.user.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:body.status,custom_title:body.custom_title,metadata:body.metadata,updated_at:new Date().toISOString()})});
   else await insertMissing(store,r,s.user.id);
 }
 async function offerLegacyImport(uid,local){
   if(local.comics.length||local.purchases.length)return false;
   const flag='mc_legacy_import_checked_'+uid;
   if(sessionStorage.getItem(flag))return false;
   sessionStorage.setItem(flag,'1');
   const legacy=['comicteca-guest-v1','comicteca-importacion-prueba-v2'];
   for(const name of legacy){
     if(name.includes('prueba'))continue; // test data must never enter production
     const exists=await new Promise(resolve=>{const req=indexedDB.open(name);let created=false;req.onupgradeneeded=()=>{created=true;req.transaction.abort()};req.onsuccess=()=>{req.result.close();resolve(!created)};req.onerror=()=>resolve(false)});
     if(!exists)continue;
     const old=await new Promise(resolve=>{const req=indexedDB.open(name);req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null)});
     if(!old)continue;
     try{
       const rows={};
       for(const store of STORES){
         if(!old.objectStoreNames.contains(store)){rows[store]=[];continue}
         rows[store]=await new Promise(resolve=>{const req=old.transaction(store,'readonly').objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>resolve([])});
       }
       const total=rows.comics.length+rows.purchases.length;
       if(!total)continue;
       if(!confirm('Se han encontrado '+rows.comics.length+' cómics y '+rows.purchases.length+' compras guardados en este navegador antes de iniciar sesión. ¿Quieres copiarlos a tu cuenta y sincronizarlos? No se borrarán los originales.'))return false;
       suspended=true;
       try{for(const store of STORES){if(rows[store].length)await bulkPut(store,rows[store]);local[store]=await allStore(store)}}finally{suspended=false}
       return true;
     }finally{old.close()}
   }
   return false;
 }
 async function synchronize(){
   if(running||!db)return;running=true;
   try{
     const s=await credentials();if(!s)return;
     const cloud=await remoteRows(),remote=new Map(cloud.filter(x=>x.local_id).map(x=>[x.local_id,x]));
     const deleted=deletedSet(s.user.id);
     for(const item of cloud)if(item.metadata?.deleted&&item.local_id){deleted.add(item.local_id);rememberDeleted(s.user.id,item.local_id)}
     const local={};for(const store of STORES)local[store]=await allStore(store);
     const localIssueIds=new Set(local.comics.map(x=>issueIdentity('comics',x)).filter(Boolean));
     const remoteIssueIds=new Set(cloud.filter(x=>x.metadata?.kind==='comics'&&!x.metadata?.deleted).map(x=>issueIdentity('comics',x.metadata.record)).filter(Boolean));
     await offerLegacyImport(s.user.id,local);
     const fingerprints=JSON.parse(localStorage.getItem('mc_cloud_fingerprints_'+s.user.id)||'{}');
     const fingerprint=r=>{const str=JSON.stringify(r),n=str.length;let h=2166136261;for(let i=0;i<n;i++)h=Math.imul(h^str.charCodeAt(i),16777619);return (h>>>0).toString(16)+':'+n};
     suspended=true;
     let downloaded=0,uploaded=0,removed=0;
     // Tombstones are authoritative across devices. Keep deletion markers remotely
     // so another device cannot re-upload an older local copy.
     for(const store of STORES){
       for(const record of local[store]){
         if(record?.id&&deleted.has(localId(store,record.id))){
           await delStore(store,record.id);
           removed++;
         }
       }
     }
     for(const item of cloud){
       const kind=item.metadata?.kind,record=item.metadata?.record;
       if(!STORES.includes(kind)||!record?.id||item.user_id!==s.user.id||deleted.has(item.local_id))continue;
       // A pre-existing local edition/issue wins over a different cloud UUID.
       // Keep both source records intact until an explicit reconciliation.
       const sameIssue=issueIdentity(kind,record);
       if(sameIssue&&localIssueIds.has(sameIssue)&&!local[kind].some(x=>x.id===record.id))continue;
       const previous=await getStore(kind,record.id),key=localId(kind,record.id),remoteHash=fingerprint(record);
       if(!previous){await putStore(kind,record);downloaded++}
       else if(fingerprints[key]&&fingerprint(previous)===fingerprints[key]&&remoteHash!==fingerprints[key]){await putStore(kind,record);downloaded++}
       if(!previous||fingerprint(previous)===remoteHash||fingerprints[key]&&fingerprint(previous)===fingerprints[key])fingerprints[key]=remoteHash;
     }
     suspended=false;
     for(const store of STORES)for(const record of local[store]){
       if(!record?.id||deleted.has(localId(store,record.id)))continue;
       const sameIssue=issueIdentity(store,record);
       if(sameIssue&&remoteIssueIds.has(sameIssue)&&!remote.has(localId(store,record.id)))continue;
       if(!remote.has(localId(store,record.id))){await insertMissing(store,record,s.user.id);fingerprints[localId(store,record.id)]=fingerprint(record);uploaded++}
     }
     localStorage.setItem('mc_cloud_fingerprints_'+s.user.id,JSON.stringify(fingerprints));
     ready=true;lastError='';
     if(downloaded&&typeof render==='function')await render();
     console.info('COMICTECA sync', {downloaded,uploaded,remote:cloud.length});
   }catch(e){suspended=false;lastError=e.message||String(e);console.warn('COMICTECA sync paused; local data preserved:',e)}
   finally{running=false;if(ready&&pending.size)setTimeout(flush,0)}
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
 const originalDel=window.delStore;
 if(typeof originalDel==='function')window.delStore=async function(store,id){
   if(!STORES.includes(store)||suspended)return originalDel(store,id);
   const result=await originalDel(store,id);
   pending.delete(localId(store,id));
   try{await markDeleted(store,id)}catch(e){lastError='Eliminación pendiente de sincronizar: '+(e.message||e);console.warn('COMICTECA delete sync',e)}
   return result;
 };
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
