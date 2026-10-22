'use strict';
/* v50: Colecciones usa el Maestro estático actual, no el store legacy.
   - normaliza variantes invisibles de identidad y el caso All-Star duplicado;
   - infiere el año cuando existe una única edición en el Maestro;
   - cuenta números únicos para que duplicados locales no falseen el progreso;
   - fuerza una reconciliación v49 -> v50 una sola vez por dispositivo.
*/
(function(){
  if(typeof allStore!=='function'||typeof collectionParts!=='function'||typeof mcSEMasterIndex!=='function'||typeof mcSEPublisherMeta!=='function'||typeof mcSEFetchJSON!=='function')return;

  const oldCanonical=window.mcCanonicalSeriesHeader;
  function kn(v){
    return String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[\u200B-\u200D\uFEFF]/g,' ').replace(/\u00A0/g,' ')
      .replace(/[‐‑–—]/g,'-').toLowerCase().replace(/\s+/g,' ').trim();
  }
  function canonical(v){
    let s=typeof oldCanonical==='function'?oldCanonical(v):kn(v);
    s=kn(s)
      .replace(/\ball[\s-]*star\s+all[\s-]*star\b/g,'all star')
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ').trim();
    return s;
  }
  window.mcCanonicalSeriesHeader=canonical;

  function pubkey(v){
    const p=typeof mcSECanonPub==='function'?mcSECanonPub(v):v;
    return kn(p);
  }
  function parts(r){
    const c=collectionParts(r||{});
    return {publisher:pubkey(c.publisher),header:canonical(c.header),volume:kn(c.volume),stage:kn(c.stage),year:kn(c.year)};
  }
  function fullKey(r){const c=parts(r);return [c.publisher,c.header,c.volume,c.stage,c.year].join('|')}
  function looseKey(r){const c=parts(r);return [c.publisher,c.header,c.volume,c.stage].join('|')}
  function issueKey(r){
    let v=String(r?.issueNr??r?.issue??'').trim();
    if(typeof mcSEIssue==='function')v=mcSEIssue(v);
    else v=v.replace(/^0+(?=\d)/,'');
    return v?kn(v):'id:'+String(r?.id||'sin-id');
  }

  try{
    ckey=fullKey;
    window.ckey=fullKey;
  }catch{}

  let cache={sig:'',full:new Map(),loose:new Map()};
  async function currentStatic(rows){
    const idx=await mcSEMasterIndex();
    const fp=[idx.snapshot||'',idx.totalIssues||0,idx.totalSeries||0,idx.generatedAt||''].join('|');
    const pubs=[...new Set((rows||[]).map(x=>String(x?.publisher||'').trim()).filter(Boolean).map(x=>typeof mcSECanonPub==='function'?mcSECanonPub(x):x))]
      .sort((a,b)=>kn(a).localeCompare(kn(b)));
    const sig=fp+'|'+pubs.map(kn).join(';');
    if(cache.sig===sig)return cache;
    const full=new Map(),loose=new Map();
    for(const p of pubs){
      const metas=mcSEPublisherMeta(idx,p)||[],paths=[];
      for(const m of metas)for(const path of m.chunks||[])if(!paths.includes(path))paths.push(path);
      for(const path of paths){
        let data=[];try{data=await mcSEFetchJSON(path)}catch(e){console.warn('v50 master chunk',path,e);continue}
        if(!Array.isArray(data))continue;
        for(const r of data){
          const k=fullKey(r),lk=looseKey(r);
          if(!full.has(k))full.set(k,{sample:r,count:0,issues:new Set()});
          const e=full.get(k);e.count++;e.issues.add(issueKey(r));
          if(!loose.has(lk))loose.set(lk,new Set());loose.get(lk).add(k);
        }
      }
    }
    for(const e of full.values())e.total=e.issues.size||e.count;
    cache={sig,full,loose};
    return cache;
  }

  function resolvedKey(r,st){
    const k=fullKey(r);if(st.full.has(k))return k;
    const c=collectionParts(r||{});
    if(!String(c.year||'').trim()){
      const set=st.loose.get(looseKey(r));
      if(set&&set.size===1)return [...set][0];
    }
    return k;
  }

  async function v50RenderSeries(){
    const r=await allStore('comics'),st=await currentStatic(r),q=norm(document.querySelector('#sq')?.value||''),p=document.querySelector('#spub')?.value||'',m={};
    for(const x of r){
      const k=resolvedKey(x,st);
      if(!m[k])m[k]={sample:x,cover:null,haveSet:new Set(),wishSet:new Set(),personalSet:new Set(),inRecords:0,wishRecords:0};
      const g=m[k],ik=issueKey(x);g.personalSet.add(ik);
      if(x.status==='In Collection'){g.haveSet.add(ik);g.inRecords++}
      if(x.status==='On Wish List'){g.wishSet.add(ik);g.wishRecords++}
      if(!g.cover&&(x.coverUrl||x.coverKey||x.coverSourceUrl))g.cover=x;
    }
    let a=Object.entries(m).map(([k,x])=>{
      const me=st.full.get(k);if(me)x.sample=me.sample;
      x.have=x.haveSet.size;x.wish=x.wishSet.size;x.personalTotal=x.personalSet.size;
      x.total=me?.total||x.personalTotal;x.duplicates=Math.max(0,x.inRecords-x.have)+Math.max(0,x.wishRecords-x.wish);
      return [k,x];
    }).filter(([,x])=>(!q||norm(clabel(x.sample)).includes(q))&&(!p||x.sample.publisher===p))
      .sort((a,b)=>clabel(a[1].sample).localeCompare(clabel(b[1].sample),'es',{numeric:true}));
    const per=60,pages=Math.max(1,Math.ceil(a.length/per));page=Math.min(page,pages);const slice=a.slice((page-1)*per,page*per),body=document.querySelector('#seriesbody');if(!body)return;
    body.innerHTML=`<div class="series-grid visual">${slice.map(([k,x])=>{const pct=x.total?Math.round(100*Math.min(x.have,x.total)/x.total):0,s=x.cover||x.sample,dup=x.duplicates?`<div class="muted small">${x.duplicates} registro${x.duplicates===1?'':'s'} duplicado${x.duplicates===1?'':'s'} detectado${x.duplicates===1?'':'s'}</div>`:'';return `<article class="series-card visual" onclick="openSeries('${encodeURIComponent(k)}')"><div class="series-cover">${img(s,'cover seriescover')}</div><div class="series-content"><div class="comic-kicker">${esc(x.sample.publisher||'Sin editorial')}</div><div class="series-title">${esc(x.sample.catalogHeader||x.sample.series)}</div><div class="master-meta">${esc([x.sample.volume&&('Vol. '+x.sample.volume),x.sample.stage,x.sample.startYear].filter(Boolean).join(' · ')||'Edición sin identificar')}</div><div class="progress"><span style="width:${Math.min(100,pct)}%"></span></div><div class="series-stats"><b>${x.have}</b> en colección · <b>${x.wish}</b> wishlist · <b>${x.total}</b> total</div><div class="series-percent">${pct}%</div>${dup}</div></article>`}).join('')||'<div class="empty">Sin resultados.</div>'}</div><div class="pager"><span>${a.length.toLocaleString('es-ES')} colecciones · Página ${page}/${pages}</span><span><button class="btn sm" ${page<=1?'disabled':''} onclick="page--;renderSeries()">Anterior</button> <button class="btn sm" ${page>=pages?'disabled':''} onclick="page++;renderSeries()">Siguiente</button></span></div>`;
    const sq=document.querySelector('#sq'),sp=document.querySelector('#spub');if(sq)sq.oninput=()=>{page=1;renderSeries()};if(sp)sp.onchange=()=>{page=1;renderSeries()};
  }

  async function v50OpenSeries(encoded){
    const k=decodeURIComponent(encoded),all=await allStore('comics'),st=await currentStatic(all),r=all.filter(x=>resolvedKey(x,st)===k).sort((a,b)=>num(a.issueNr)-num(b.issueNr)),ms=st.full.get(k)?.sample,sample=ms||r[0];
    const modal=document.querySelector('#modal');if(!modal)return;
    modal.innerHTML=`<div class="modalbox"><div class="modalhead"><div><b>${esc(sample?clabel(sample):'Colección')}</b><div class="muted small">${new Set(r.filter(x=>x.status==='In Collection').map(issueKey)).size} números en colección · ${new Set(r.filter(x=>x.status==='On Wish List').map(issueKey)).size} wishlist · ${r.length} registros</div></div><button class="btn" onclick="closeModal()">Cerrar</button></div><div class="modalbody"><div class="issue-grid">${r.map(x=>`<article class="issue-card" onclick="editComic('${esc(x.id)}')">${img(x,'cover issuecover')}<div class="issue-body"><div class="issue-no">#${esc(x.issueNr||x.issue||'—')}</div><div class="issue-title">${esc(x.title||x.subtitle||'Sin título')}</div><div>${statusPill(x.status)}</div></div></article>`).join('')}</div></div></div>`;modal.classList.remove('hidden');
  }

  try{renderSeries=v50RenderSeries;window.renderSeries=v50RenderSeries;openSeries=v50OpenSeries;window.openSeries=v50OpenSeries}catch{}
  window.mcCollectionIdentityV50={canonical,fullKey,looseKey,issueKey,currentStatic,resolvedKey};

  try{
    const mark='mc_v50_collection_identity_boot';
    if(!localStorage.getItem(mark)){
      localStorage.removeItem('mc_catalog_master_reconcile_v49');
      localStorage.setItem(mark,new Date().toISOString());
    }
  }catch{}
})();
