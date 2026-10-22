'use strict';
/* v32: completar portadas del catálogo con una única acción del usuario. */
(function(){
  let running=false;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const code=v=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const issue=v=>String(v??'').trim();
  const hasSource=x=>/^https:\/\//i.test(String(x?.coverUrl||''))||/^data:image\//i.test(String(x?.coverUrl||''));

  function safeCandidate(x,c){
    const d=c?.data||{};
    if(!d.coverUrl)return false;
    const xc=code(x.isbn),dc=code(d.isbn);
    if(xc&&dc&&xc===dc)return true;
    if(!issue(x.issueNr??x.issue)||!issue(d.issueNr)||!mcSEIssueExact(issue(x.issueNr??x.issue),issue(d.issueNr)))return false;
    if(x.publisher&&d.publisher&&!mcSEPubCompatible(x.publisher,d.publisher))return false;
    if((x.catalogHeader||x.series)&&d.series&&mcSESeriesScore(x.catalogHeader||x.series,d.series)<0.90)return false;
    if(x.startYear&&d.startYear&&String(x.startYear)!==String(d.startYear))return false;
    return Number(c.score||0)>=9000;
  }

  async function candidateFor(x){
    if(hasSource(x))return {source:'asociada',data:{coverUrl:x.coverUrl,coverUrls:[x.coverUrl]}};
    const list=typeof mcSESearch==='function'?await mcSESearch(x):[];
    return (list||[]).find(c=>safeCandidate(x,c))||null;
  }

  async function attach(x,c){
    if(c.source==='asociada')return CoverVault.attach(x,c.data.coverUrl);
    if(typeof mcSEAttachCover==='function')return mcSEAttachCover(x,c);
    return CoverVault.attach(x,c.data.coverUrl);
  }

  function paint(s){
    const el=document.getElementById('mcAutoCoverProgress');if(!el)return;
    el.textContent=`Revisadas ${s.checked}/${s.total} · guardadas ${s.saved} · sin coincidencia segura ${s.skipped} · incidencias ${s.errors}`;
  }

  async function runAll(){
    if(running)return toast('El proceso de portadas ya está en marcha');
    if(!window.CoverVault?.hasCredentials?.()){
      toast('Carga primero la clave y la credencial desde Sincronizar');
      window.CloudSync?.show?.();
      return;
    }
    const rows=(await allStore('comics')).filter(x=>x.status==='In Collection'&&!x.coverKey);
    if(!rows.length)return toast('Todas las fichas del catálogo ya tienen portada propia');
    const s={checked:0,total:rows.length,saved:0,skipped:0,errors:0};
    running=true;paint(s);busy(true,'Completando portadas del catálogo…');
    try{
      for(const x of rows){
        try{
          const c=await candidateFor(x);
          if(!c)s.skipped++;
          else{await attach(x,c);s.saved++}
        }catch(e){console.warn('AutoCover',x.id,e);s.errors++}
        s.checked++;paint(s);await sleep(180);
      }
      window.CloudSync?.schedule?.();
      toast(`Proceso terminado: ${s.saved} portadas guardadas`);
      if(document.getElementById('coversbody'))await renderCovers();
      paint(s);
    }finally{running=false;busy(false)}
  }

  const baseCoversView=window.coversView;
  if(typeof baseCoversView==='function')window.coversView=async function(){
    const html=await baseCoversView();
    const box=`<div class="notice oknotice" style="display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div><b>Completar portadas del catálogo</b><div class="small muted">Procesa automáticamente En colección: portadas ya enlazadas y coincidencias seguras del Maestro/ISBN. No modifica coincidencias dudosas.</div><div id="mcAutoCoverProgress" class="small muted"></div></div><button class="btn primary" onclick="AutoCover.runAll()">Completar portadas del catálogo</button></div>`;
    return html.replace('<div class="panel">',box+'<div class="panel">');
  };
  window.AutoCover={runAll};
})();
