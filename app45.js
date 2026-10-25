'use strict';
/* v66: Aceptar una coincidencia verificada no depende de que el navegador pueda hacer fetch de la imagen. */
(function(){
  const coverUrl=c=>String(c?.data?.coverUrl||(Array.isArray(c?.data?.coverUrls)?c.data.coverUrls[0]:'')||'').trim();

  async function keepRemote(record,candidate){
    const u=coverUrl(candidate);if(!record?.id||!u)return record;
    const current=await getStore('comics',record.id)||record;
    const next={...current,coverUrl:u,coverSourceUrl:u,coverUrls:Array.isArray(candidate?.data?.coverUrls)?candidate.data.coverUrls:[u],coverRemotePending:true};
    await putStore('comics',next);return next;
  }

  if(typeof window.mcAcceptUnified==='function'){
    window.mcAcceptUnified=async function(){
      const c=MCSearch?.ficha?.[MCSearch.selectedFicha];if(!c)return toast('Selecciona un resultado');
      busy(true,'Guardando datos y portada…');
      try{
        await mcSEApplyFields(c.data||{});
        const r=await mcPersistFormForCover();
        let local=false;
        try{if(window.CoverVault?.attach&&coverUrl(c)){await mcSEAttachCover(r,c);local=true}}catch(e){console.warn('Portada remota conservada; copia local pendiente',e)}
        if(!local&&coverUrl(c))await keepRemote(r,c);
        try{window.CloudSync?.schedule?.()}catch{}
        toast(local?'Datos y portada guardados':'Datos y portada aceptados; copia local pendiente');
        await editComic(r.id);
      }catch(e){console.error(e);toast('No se pudo completar la ficha: '+(e?.message||e))}
      finally{busy(false)}
    };
  }

  if(typeof window.mcAcceptSeriesQuick==='function'){
    window.mcAcceptSeriesQuick=async function(){
      const c=MCSearch?.quick?.[MCSearch.selectedQuick]||mcSeriesQuickCandidates?.[mcSeriesQuickSelected],id=MCSearch?.quickId||mcSeriesQuickId;
      if(!c||!id)return toast('Selecciona un resultado');
      const x=await getStore('comics',id);if(!x)return toast('No se encontró la ficha');
      const d=c.data||{},a=x.authors||{};
      const y=cleanComic({...x,publisher:x.publisher||d.publisher,catalogHeader:x.catalogHeader||x.series||d.series,series:x.series||x.catalogHeader||d.series,volume:x.volume||d.volume,stage:x.stage||d.stage,startYear:x.startYear||d.startYear,title:x.title||d.title,publicationDate:x.publicationDate||d.publicationDate,pages:x.pages||d.pages,isbn:x.isbn||d.isbn,format:x.format||d.format,authors:{...a,writer:a.writer||d.writer||'',artist:a.artist||d.artist||'',inker:a.inker||d.inker||'',colorist:a.colorist||d.colorist||''}});
      await putStore('comics',y);
      let local=false;
      try{if(!x.coverKey&&!x.coverUrl&&coverUrl(c)&&CoverVault?.attach){await CoverVault.attach(y,coverUrl(c));local=true}}catch(e){console.warn('Portada remota conservada; copia local pendiente',e)}
      if(!local&&!x.coverKey&&!x.coverUrl&&coverUrl(c))await keepRemote(y,c);
      const enc=MCSearch?.quickEncoded||mcSeriesReturnEncoded,scroll=MCSearch?.quickScroll||mcSeriesScrollTop;
      try{mcCancelSeriesQuick()}catch{}
      toast(local?'Datos y portada guardados':'Datos y portada aceptados; copia local pendiente');
      await openSeries(enc);const b=$('#modal .modalbody');if(b)b.scrollTop=scroll;
    };
  }
})();
