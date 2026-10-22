'use strict';
/* Bóveda propia de portadas: almacena copias comprimidas y cifradas en sync-data. */
(function(){
 const OWNER='ramsesluque-ai',REPO='mi-comicoteca',BRANCH='sync-data',CACHE='mi-comicoteca-cover-vault-v1';
 const PASS_KEY='mc_sync_pass_v1',TOKEN_KEY='mc_github_token_v1';
 const enc=new TextEncoder();
 const safe=s=>String(s||'cover').replace(/[^a-zA-Z0-9_.-]/g,'_');
 const b64=u=>{let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(s)};
 const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 const pass=()=>sessionStorage.getItem(PASS_KEY)||localStorage.getItem(PASS_KEY)||'';
 const token=()=>localStorage.getItem(TOKEN_KEY)||'';
 const cacheUrl=k=>'https://mi-comicoteca.local/cover/'+encodeURIComponent(safe(k));
 const rawUrl=k=>`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/covers/${safe(k)}.enc.json`;
 const apiUrl=k=>`https://api.github.com/repos/${OWNER}/${REPO}/contents/covers/${safe(k)}.enc.json`;
 let objectUrls=new Map(),inflight=new Map();
 async function derive(p,salt,it=180000){const base=await crypto.subtle.importKey('raw',enc.encode(p),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:it,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
 async function encryptBlob(blob){const p=pass();if(!p)throw Error('Introduce primero la clave de sincronización');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await derive(p,salt),plain=new Uint8Array(await blob.arrayBuffer()),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain));return{v:1,alg:'AES-GCM',kdf:'PBKDF2-SHA256',iterations:180000,mime:blob.type||'image/webp',size:blob.size,salt:b64(salt),iv:b64(iv),ciphertext:b64(ct)}}
 async function decryptBlob(e){const p=pass();if(!p)throw Error('Falta la clave de sincronización');const key=await derive(p,unb64(e.salt),e.iterations||180000),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(e.iv)},key,unb64(e.ciphertext));return new Blob([plain],{type:e.mime||'image/webp'})}
 async function compress(blob){const bmp=await createImageBitmap(blob),maxW=480,maxH=720,scale=Math.min(1,maxW/bmp.width,maxH/bmp.height),w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale)),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(bmp,0,0,w,h);bmp.close?.();const out=await new Promise(res=>c.toBlob(b=>res(b),'image/webp',.78));if(out)return out;return new Promise(res=>c.toBlob(b=>res(b),'image/jpeg',.8))}
 async function fetchAndCompress(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('No se pudo descargar la portada ('+r.status+')');const b=await r.blob();if(!String(b.type).startsWith('image/'))throw Error('La dirección no devolvió una imagen');return compress(b)}
 async function cachePut(k,blob){const c=await caches.open(CACHE);await c.put(cacheUrl(k),new Response(blob,{headers:{'Content-Type':blob.type||'image/webp'}}));if(objectUrls.has(k)){URL.revokeObjectURL(objectUrls.get(k));objectUrls.delete(k)}}
 async function cacheGet(k){const c=await caches.open(CACHE),r=await c.match(cacheUrl(k));return r?await r.blob():null}
 async function fileSha(k){const t=token();if(!t)return null;const r=await fetch(apiUrl(k)+'?ref='+encodeURIComponent(BRANCH),{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+t,'X-GitHub-Api-Version':'2022-11-28'},cache:'no-store'});if(r.status===404)return null;if(!r.ok)throw Error('No se pudo comprobar la portada central ('+r.status+')');return (await r.json()).sha||null}
 async function upload(k,blob){const t=token();if(!t)throw Error('Falta la credencial GitHub de escritura');const env=await encryptBlob(blob),sha=await fileSha(k),body={message:'Guarda portada '+k,content:b64(enc.encode(JSON.stringify(env))),branch:BRANCH};if(sha)body.sha=sha;const r=await fetch(apiUrl(k),{method:'PUT',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+t,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){let m='';try{m=(await r.json()).message}catch{}throw Error('No se pudo sincronizar la portada ('+r.status+'): '+m)}}
 async function remoteBlob(k){const r=await fetch(rawUrl(k)+'?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Portada central no disponible');return decryptBlob(await r.json())}
 async function objectUrl(k){if(objectUrls.has(k))return objectUrls.get(k);if(inflight.has(k))return inflight.get(k);const p=(async()=>{let b=await cacheGet(k);if(!b){b=await remoteBlob(k);await cachePut(k,b)}const u=URL.createObjectURL(b);objectUrls.set(k,u);inflight.delete(k);return u})().catch(e=>{inflight.delete(k);throw e});inflight.set(k,p);return p}
 async function attach(comic,sourceUrl){if(!comic?.id)throw Error('Ficha no válida');const blob=await fetchAndCompress(sourceUrl);await cachePut(comic.id,blob);await upload(comic.id,blob);const updated={...comic,coverKey:comic.id,coverSourceUrl:sourceUrl,coverUrl:''};await putStore('comics',updated);return updated}
 async function attachFile(comic,file){if(!comic?.id)throw Error('Ficha no válida');const blob=await compress(file);await cachePut(comic.id,blob);await upload(comic.id,blob);const updated={...comic,coverKey:comic.id,coverSourceUrl:'archivo local',coverUrl:''};await putStore('comics',updated);return updated}
 async function hydrate(root=document){const slots=[...root.querySelectorAll('.mc-cover-slot[data-cover-key]:not([data-loading])')];for(const el of slots){el.dataset.loading='1';const k=el.dataset.coverKey;objectUrl(k).then(u=>{const im=document.createElement('img');im.className=el.className.replace(/\bmc-cover-slot\b/g,'').replace(/\bcoverph\b/g,'').trim();im.src=u;im.alt='Portada';im.loading='lazy';im.decoding='async';el.replaceWith(im)}).catch(()=>{el.textContent='🔒 Portada guardada';el.classList.add('coverph')})}}
 const obs=new MutationObserver(()=>hydrate());window.addEventListener('load',()=>{obs.observe(document.body,{subtree:true,childList:true});hydrate()});
 window.CoverVault={attach,attachFile,objectUrl,hydrate,fetchAndCompress,hasCredentials:()=>!!(pass()&&token()),passReady:()=>!!pass(),tokenReady:()=>!!token()};
})();
