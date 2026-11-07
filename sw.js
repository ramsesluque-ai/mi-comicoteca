// COMICTECA: offline cache isolated by asset type; never serve HTML as JavaScript/CSS.
const CACHE='comicteca-v79-versioned-offline';
const COVER_CACHES=['mi-comicoteca-cover-vault-v1'];
const ASSETS=['./','./index.html','./styles.css','./visual.css','./classic.css','./rich-theme.css','./ficha-search.css','./branding.css','./master-update.css','./sync.css','./filter-ui.css','./brand-logo.svg','./app1.js','./app2.js','./app3.js','./app4.js','./app5.js','./app6.js','./app7.js','./app8.js','./app9.js','./app10.js','./app11.js','./app12.js','./app14.js','./app15.js','./app24.js','./app26.js','./app27.js','./app28.js','./app29.js','./app30.js','./app31.js','./app32.js','./app33.js','./app34.js','./app35.js','./app36.js','./app37.js','./app38.js','./app39.js','./app40.js','./app41.js','./app42.js','./app43.js','./app44.js','./app45.js','./app46.js','./app47.js','./app48.js','./app49.js','./filter-ui.js','./search-engine.js','./master-static.js','./vault.js','./migration.js','./sync.js','./setup.js','./master-data/index.json','./master-data/cover-overrides.json','./dashboard-pbi.css','./dashboard-pbi.js','./navigation-fix.js','./cloud-migration.js','./commercial-billing.js','./manifest.webmanifest','./icon.svg'];
const NAV_FALLBACK='./index.html';
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // A temporarily missing optional asset must not prevent SW installation.
    await Promise.allSettled(ASSETS.map(async path=>{
      const response=await fetch(new Request(path,{cache:'reload'}));
      if(response.ok)await cache.put(path,response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE&&!COVER_CACHES.includes(k)&&k.startsWith('comicteca-')).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(request,{cache:'no-store'});
      if(response.ok){
        const cache=await caches.open(CACHE);
        event.waitUntil(cache.put(request,response.clone()).catch(()=>{}));
      }
      return response;
    }catch(error){
      // Versioned assets are precached without ?v=; match the same path offline.
      const cached=await caches.match(request,{ignoreSearch:true});
      if(cached)return cached;
      if(request.mode==='navigate'){
        const shell=await caches.match(NAV_FALLBACK);
        if(shell)return shell;
      }
      // No HTML fallback for JS/CSS/JSON/images: avoids MIME errors and bogus data.
      return Response.error();
    }
  })());
});
