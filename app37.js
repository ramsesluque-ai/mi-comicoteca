'use strict';
/* v48: reconciliación Maestro -> Catálogo.
   Corrige cabecera/serie/edición y algunos títulos SOLO cuando la correspondencia es inequívoca.
   El catálogo privado se modifica en el navegador y luego se sincroniza cifrado.
*/
(function(){
  if(typeof allStore!=='function'||typeof putStore!=='function'||typeof mcSEMasterIndex!=='function'||typeof mcSEPublisherMeta!=='function')return;

  /* Preservar metadatos técnicos al volver a guardar una ficha desde cualquier formulario. */
  if(typeof cleanComic==='function'){
    const baseClean=cleanComic;
    cleanComic=function(r={}){
      const x=baseClean(r);
      return{...x,
        sourceId:r.sourceId||x.sourceId||'',barcode:r.barcode||x.barcode||'',
        coverSyncPending:r.coverSyncPending===true,coverSyncedAt:r.coverSyncedAt||'',
        coverRejectedSourceUrl:r.coverRejectedSourceUrl||'',coverRejectedAt:r.coverRejectedAt||'',
        masterReconciledId:r.masterReconciledId||'',masterReconciledAt:r.masterReconciledAt||''
      };
    };
    window.cleanComic=cleanComic;
  }

  const STATE_KEY='mc_catalog_master_reconcile_v48';
  const MAX_RECORDS_PER_PUBLISHER=5000;
  let running=false,timer=null,last={publishers:0,checked:0,matched:0,changed:0,ambiguous:0,errors:0,done:false};
  const n=v=>typeof mcSENorm==='function'?mcSENorm(v):String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const code=v=>typeof mcSECode==='function'?mcSECode(v):String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const issue=v=>typeof mcSEIssue==='function'?mcSEIssue(v):String(v??'').trim().replace(/^0+(?=\d)/,'');
  const pub=v=>typeof mcSECanonPub==='function'?mcSECanonPub(v):String(v??'').trim();
  const header=v=>typeof window.mcCanonicalSeriesHeader==='function'?window.mcCanonicalSeriesHeader(v):n(v);
  const same=(a,b)=>n(a)===n(b);

  function stateGet(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{}}}
  function stateSet(v){localStorage.setItem(STATE_KEY,JSON.stringify(v))}
  function push(map,k,v){if(!k)return;if(!map.has(k))map.set(k,[]);map.get(k).push(v)}

  function buildIndex(rows){
    const byIsbn=new Map(),bySid=new Map(),byHeaderIssue=new Map();
    for(const r of rows){
      const i=code(r.isbn||r.barcode||'');if(i)push(byIsbn,i,r);
      const sid=String(r.sourceId||'').trim();if(sid)push(bySid,sid,r);
      const h=header(r.catalogHeader||r.series||''),num=issue(r.issueNr??r.issue??'');
      if(h&&num)push(byHeaderIssue,h+'|'+num,r);
    }
    return{byIsbn,bySid,byHeaderIssue};
  }

  function choose(x,idx){
    const isbn=code(x.isbn||x.barcode||'');
    if(isbn){const a=idx.byIsbn.get(isbn)||[];if(a.length===1)return{row:a[0],confidence:'isbn'};if(a.length>1){const p=a.filter(r=>n(pub(r.publisher))===n(pub(x.publisher)));if(p.length===1)return{row:p[0],confidence:'isbn'}}}
    const sid=String(x.sourceId||'').trim();
    if(sid){const a=idx.bySid.get(sid)||[];if(a.length===1)return{row:a[0],confidence:'sourceId'}}
    const h=header(x.catalogHeader||x.series||''),num=issue(x.issueNr??x.issue??'');
    if(!h||!num)return null;
    let a=(idx.byHeaderIssue.get(h+'|'+num)||[]).filter(r=>n(pub(r.publisher))===n(pub(x.publisher)));
    if(!a.length)return null;if(a.length===1)return{row:a[0],confidence:'unique'};

    /* Con varias ediciones del mismo nº, usar etapa/año como discriminadores fuertes. */
    const xs=n(x.stage||''),xy=String(x.startYear||'').trim(),xv=n(x.volume||'');
    if(xs){const z=a.filter(r=>n(r.stage||'')===xs);if(z.length===1)return{row:z[0],confidence:'stage'};if(z.length)a=z}
    if(xy){const z=a.filter(r=>String(r.startYear||'').trim()===xy);if(z.length===1)return{row:z[0],confidence:'year'};if(z.length)a=z}
    if(xv){const z=a.filter(r=>n(r.volume||'')===xv);if(z.length===1)return{row:z[0],confidence:'volume'};if(z.length)a=z}
    return a.length===1?{row:a[0],confidence:'edition'}:{ambiguous:true,count:a.length};
  }

  async function authoritativeMeta(r){
    try{
      const over=await mcSEOverrides(),o=typeof window.mcMasterOverrideFor==='function'?window.mcMasterOverrideFor(r,over):null;
      if(o&&String(o.source||'').toLowerCase().includes('tebeosfera'))return o;
    }catch{}
    return null;
  }

  async function apply(x,m){
    const r=m.row,auth=await authoritativeMeta(r),strong=['isbn','sourceId','stage','year','edition'].includes(m.confidence);
    const next={...x};let changed=false;
    const set=(k,v)=>{v=String(v??'').trim();if(!v)return;if(String(next[k]??'').trim()!==v){next[k]=v;changed=true}};
    set('publisher',r.publisher||x.publisher);
    set('catalogHeader',r.catalogHeader||r.series||x.catalogHeader||x.series);
    set('series',r.series||r.catalogHeader||x.series||x.catalogHeader);
    if(strong){set('volume',r.volume);set('stage',r.stage);set('startYear',r.startYear)}
    else{
      if(!next.volume)set('volume',r.volume);if(!next.stage)set('stage',r.stage);if(!next.startYear)set('startYear',r.startYear);
    }
    if(!next.isbn&&r.isbn)set('isbn',r.isbn);
    if(!next.barcode&&r.barcode)set('barcode',r.barcode);
    if(!next.sourceId&&r.sourceId)set('sourceId',r.sourceId);
    /* Título: Tebeosfera manda si aporta uno usable; en su defecto completar vacíos desde Maestro. */
    const at=String(auth?.title||'').replace(/\s*[|·-]\s*Tebeosfera.*$/i,'').trim();
    if(at&&at.length<=180&&strong)set('title',at);
    else if(!next.title&&r.title)set('title',r.title);
    if(!next.publicationDate&&(auth?.publicationDate||r.publicationDate))set('publicationDate',auth?.publicationDate||r.publicationDate);
    if(!next.pages&&(auth?.pages||r.pages))set('pages',auth?.pages||r.pages);
    next.masterReconciledId=String(r.id||r.sourceId||'');next.masterReconciledAt=new Date().toISOString();
    if(changed)await putStore('comics',next);else if(next.masterReconciledId!==x.masterReconciledId)await putStore('comics',next);
    return changed;
  }

  async function loadPublisher(pubName){
    const idx=await mcSEMasterIndex(),metas=mcSEPublisherMeta(idx,pubName)||[],paths=[];
    for(const m of metas)for(const p of m.chunks||[])if(!paths.includes(p))paths.push(p);
    const rows=[];for(const p of paths){try{const r=await mcSEFetchJSON(p);if(Array.isArray(r))rows.push(...r)}catch(e){console.warn('Reconcile chunk',p,e)}}
    return rows;
  }

  async function run(force=false){
    if(running||window.__mcCoverRepairRunning||document.visibilityState==='hidden')return last;
    const comics=await allStore('comics');if(!comics.length)return last;
    const idx=await mcSEMasterIndex(),snapshot=String(idx.snapshot||idx.generatedAt||'master');
    let st=stateGet();if(force||st.snapshot!==snapshot)st={snapshot,publisherIndex:0,checked:0,matched:0,changed:0,ambiguous:0,errors:0,done:false};
    if(st.done&&!force){last={...st,publishers:st.publisherIndex||0};return last}

    const groups=new Map();for(const x of comics){if(!x?.publisher)continue;const k=n(pub(x.publisher));if(!groups.has(k))groups.set(k,{publisher:x.publisher,rows:[]});if(groups.get(k).rows.length<MAX_RECORDS_PER_PUBLISHER)groups.get(k).rows.push(x)}
    const list=[...groups.values()].sort((a,b)=>String(a.publisher).localeCompare(String(b.publisher),'es'));
    if(st.publisherIndex>=list.length){st.done=true;stateSet(st);last={...st,publishers:list.length};return last}

    running=true;window.__mcCatalogReconcileRunning=true;
    try{
      const g=list[st.publisherIndex],master=await loadPublisher(g.publisher),ix=buildIndex(master);let changedThis=0;
      for(const x of g.rows){
        st.checked++;try{
          const m=choose(x,ix);if(!m)continue;if(m.ambiguous){st.ambiguous++;continue}
          st.matched++;if(await apply(x,m)){st.changed++;changedThis++}
        }catch(e){console.warn('Catalog reconcile',x?.id,e);st.errors++}
      }
      st.publisherIndex++;stateSet(st);last={...st,publishers:list.length};
      if(changedThis&&typeof toast==='function')toast(`${g.publisher}: ${changedThis} ficha${changedThis===1?'':'s'} reconciliada${changedThis===1?'':'s'} con el Maestro`);
      if(st.publisherIndex<list.length)schedule(300);else{
        st.done=true;stateSet(st);last={...st,publishers:list.length,done:true};
        try{window.CloudSync?.schedule?.()}catch{}
        setTimeout(()=>window.mcRepairExistingCovers?.rerun?.(),400);
        setTimeout(()=>window.mcAutoImportMasterCovers?.schedule?.(0),1200);
        if(typeof toast==='function')toast(`Reconciliación terminada: ${st.changed} fichas corregidas · ${st.ambiguous} ambiguas sin tocar`);
      }
      return last;
    }finally{window.__mcCatalogReconcileRunning=false;running=false}
  }
  function schedule(delay=1200){clearTimeout(timer);timer=setTimeout(()=>run(false),Math.max(200,Number(delay)||1200))}
  function rerun(){localStorage.removeItem(STATE_KEY);return run(true)}

  window.mcReconcileCatalogMaster={run,rerun,status:()=>({...last,running})};
  window.addEventListener('load',()=>schedule(2500));
  if(window.CloudSync?.pull){const base=window.CloudSync.pull;window.CloudSync.pull=async function(...args){const r=await base.apply(this,args);schedule(900);return r}}
})();