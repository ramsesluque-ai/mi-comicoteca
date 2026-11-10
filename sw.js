// COMICTECA: offline cache isolated by asset type; never serve HTML as JavaScript/CSS.
const CACHE='comicteca-v126-resend-mail-qa';
const COVER_CACHES=['mi-comicoteca-cover-vault-v1'];
const ASSETS=['./','./index.html','./styles.css','./visual.css','./classic.css','./rich-theme.css','./ficha-search.css','./branding.css','./master-update.css','./novedades.css','./contacto.css','./mobile-navigation.css','./mobile-navigation.js','./novedades.js','./novedades-editoriales.json','./mi-comicteca-logo.svg','./icon.svg','./sync.css','./filter-ui.css','./brand-logo.svg','./comicteca-logo-real.webp','./app1.js','./app2.js','./app3.js','./app4.js','./app5.js','./app6.js','./app7.js','./app8.js','./app9.js','./app10.js','./app11.js','./app12.js','./app14.js','./app15.js','./app24.js','./app26.js','./app27.js','./app28.js','./app29.js','./app30.js','./app31.js','./app32.js','./app33.js','./app34.js','./app35.js','./app36.js','./app37.js','./app38.js','./app39.js','./app40.js','./app41.js','./app42.js','./app43.js','./app44.js','./app45.js','./app46.js','./app47.js','./app48.js','./app49.js','./filter-ui.js','./search-engine.js','./master-static.js','./vault.js','./migration.js','./sync.js','./setup.js','./master-data/index.json','./master-data/cover-overrides.json','./dashboard-pbi.css','./dashboard-pbi.js','./navigation-fix.js','./cloud-migration.js','./commercial-billing.js','./master-series-ui.js','./bridge-client.js','./publisher-search.js','./catalog-bulk.js','./manifest.webmanifest','./icon.svg'];
const NAV_FALLBACK='./index.html';
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // A temporarily missing optional asset must not prevent SW installation.
    // The app shell and BI modules are mandatory. Do not activate a new
    // offline cache if any of them failed to download: a successful install
    // with a missing BI script would silently leave the dashboard broken.
    const critical=new Set(['./novedades.js','./novedades-editoriales.json','./index.html','./dashboard-pbi.js','./dashboard-pbi.css','./comicteca-logo-real.webp','./mi-comicteca-logo.svg']);
    const results=await Promise.allSettled(ASSETS.map(async path=>{
      const response=await fetch(new Request(path,{cache:'reload'}));
      if(!response.ok){
        if(critical.has(path))throw new Error('Critical asset unavailable: '+path+' ('+response.status+')');
        return;
      }
      // Some static hosts return the SPA HTML fallback with HTTP 200 for missing files.
      // Reject wrong MIME types before caching mandatory BI and branding assets.
      if(critical.has(path)){
        const type=(response.headers.get('content-type')||'').toLowerCase();
        const expected=path.endsWith('.js')?['javascript','ecmascript']:path.endsWith('.css')?['text/css']:path.endsWith('.webp')?['image/webp']:path.endsWith('.svg')?['image/svg+xml']:path.endsWith('.json')?['application/json','text/json']:['text/html'];
        if(!expected.some(mime=>type.includes(mime)))throw new Error('Critical asset has wrong MIME: '+path+' ('+type+')');
      }
      await cache.put(path,response);
    }));
    const missing=results.filter((result,index)=>result.status==='rejected' && critical.has(ASSETS[index]));
    if(missing.length){
      await caches.delete(CACHE);
      throw new Error('COMICTECA offline install aborted: missing mandatory dashboard assets');
    }
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
  // Only cache the public static application. Never persist authenticated,
  // personal or payment responses in a shared service-worker cache.
  const path=url.pathname;
  const privatePath=/(?:^|\/)(?:api|auth|user|users|account|accounts|profile|profiles|billing|checkout|stripe|webhook|webhooks)(?:\/|$)/i.test(path);
  const hasCredentials=request.headers.has('authorization')||request.headers.has('cookie');
  if(privatePath||hasCredentials||request.cache==='no-store')return;
  // Cache only explicitly shipped public assets. Dynamic JSON, exports, and
  // user-created files must never enter a persistent shared cache.
  const publicAsset=new Set(ASSETS.map(asset=>new URL(asset,self.registration.scope).pathname));
  const isStatic=publicAsset.has(path);
  if(!isStatic && request.mode!=='navigate')return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(request,{cache:'no-store'});
      const criticalTypes={
        '/dashboard-pbi.js':['javascript','ecmascript'],
        '/dashboard-pbi.css':['text/css'],
        '/comicteca-logo-real.webp':['image/webp'],
        '/mi-comicteca-logo.svg':['image/svg+xml']
      };
      const expected=Object.entries(criticalTypes).find(([suffix])=>path.endsWith(suffix))?.[1];
      const type=(response.headers.get('content-type')||'').toLowerCase();
      const validType=!expected||expected.some(mime=>type.includes(mime));
      // Do not display or cache HTML fallback masquerading as a critical asset.
      if(response.ok && !validType)return Response.error();
      if(response.ok && validType && isStatic && response.type==='basic' && !response.headers.has('set-cookie') && !/private|no-store/i.test(response.headers.get('cache-control')||'')){
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
