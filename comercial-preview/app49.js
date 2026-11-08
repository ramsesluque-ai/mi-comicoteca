'use strict';
/* v70: portadas locales: conservar metadatos de bóveda y renderizar desde CoverVault. */
(function(){
  const baseClean=cleanComic;
  cleanComic=function(r={}){
    const x=baseClean(r);
    return {...x,
      coverKey:r.coverKey||r.cover_key||'',
      coverSourceUrl:r.coverSourceUrl||r.cover_source_url||'',
      coverSyncPending:r.coverSyncPending===true,
      coverSyncedAt:r.coverSyncedAt||'',
      coverRejectedSourceUrl:r.coverRejectedSourceUrl||'',
      coverRejectedAt:r.coverRejectedAt||'',
      coverRemotePending:r.coverRemotePending===true,
      source:r.source||'',sourceId:r.sourceId||'',sourceUrl:r.sourceUrl||'',externalId:r.externalId||''
    };
  };
  img=function(r,cls='cover'){
    const key=String(r?.coverKey||'').trim();
    const src=String(r?.coverSourceUrl||'').trim();
    if(key){
      return `<div class="${cls} coverph mc-cover-slot" data-cover-key="${esc(key)}" data-cover-source="${esc(/^https?:\/\//i.test(src)?src:'')}">Cargando portada…</div>`;
    }
    const u=String(r?.coverUrl||'').trim();
    return u&&/^https:\/\//i.test(u)
      ? `<img class="${cls}" src="${esc(u)}" alt="Portada" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;${cls} coverph&quot;>Sin portada</div>'">`
      : `<div class="${cls} coverph">Sin portada</div>`;
  };
  const baseRender=render;
  render=async function(){const out=await baseRender();setTimeout(()=>window.CoverVault?.hydrate?.(document),0);return out};
  const baseRenderCat=renderCat;
  renderCat=async function(wish=false){const out=await baseRenderCat(wish);setTimeout(()=>window.CoverVault?.hydrate?.(document),0);return out};
  const baseRenderCovers=renderCovers;
  renderCovers=async function(){const out=await baseRenderCovers();setTimeout(()=>window.CoverVault?.hydrate?.(document),0);return out};
})();