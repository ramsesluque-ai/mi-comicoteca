'use strict';
/* v48: permite borrar una portada desde la ficha sin borrar el cómic. */
(function(){
  if(typeof window.editComic!=='function'||typeof getStore!=='function'||typeof putStore!=='function')return;
  const baseEdit=window.editComic;
  const CACHE='mi-comicoteca-cover-vault-v1';
  const safe=s=>String(s||'cover').replace(/[^a-zA-Z0-9_.-]/g,'_');
  const cacheUrl=k=>'https://mi-comicoteca.local/cover/'+encodeURIComponent(safe(k));
  const hasCover=r=>!!String(r?.coverKey||r?.coverUrl||r?.coverSourceUrl||'').trim();

  window.mcDeleteComicCover=async function(id){
    const r=await getStore('comics',id);if(!r)return toast('No se encontró la ficha');
    if(!hasCover(r))return toast('La ficha no tiene portada');
    if(!confirm('¿Borrar la portada de esta ficha? Se conservarán todos los demás datos del cómic.'))return;
    busy(true,'Borrando portada…');
    try{
      if(r.coverKey){try{const c=await caches.open(CACHE);await c.delete(cacheUrl(r.coverKey))}catch{}}
      const rejected=String(r.coverSourceUrl||r.coverUrl||'').trim();
      const updated={...r,
        coverKey:'',coverUrl:'',coverUrls:[],coverSourceUrl:'',coverSyncPending:false,coverSyncedAt:'',
        coverRejectedSourceUrl:rejected,coverRejectedAt:new Date().toISOString()
      };
      await putStore('comics',updated);
      try{window.CloudSync?.schedule?.()}catch{}
      toast('Portada borrada; la ficha conserva todos sus datos');
      await baseEdit(id);
      await inject(id);
    }catch(e){console.error(e);toast('No se pudo borrar la portada: '+(e?.message||e))}
    finally{busy(false)}
  };

  async function inject(id){
    if(!id)return;const r=await getStore('comics',id);if(!r||!hasCover(r))return;
    const foot=document.querySelector('#modal .modalfoot');if(!foot||foot.querySelector('[data-delete-cover]'))return;
    const b=document.createElement('button');b.className='btn danger';b.dataset.deleteCover='1';b.textContent='Borrar portada';
    b.onclick=()=>window.mcDeleteComicCover(id);const first=foot.firstElementChild;first?foot.insertBefore(b,first.nextSibling):foot.appendChild(b);
  }

  window.editComic=async function(id){const r=await baseEdit(id);try{await inject(id)}catch{}return r};
})();