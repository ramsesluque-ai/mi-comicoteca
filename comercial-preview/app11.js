'use strict';
/* v17: Maestro España vivo + actualización incremental bajo demanda */
const MC_MASTER_LAST='mc_master_last_update_v2';
const MC_MASTER_WEEK='mc_master_last_week_v2';
const MC_MASTER_MAX_WEEKS=8;
const mcMasterViewV16=masterView;

function mcMasterStatusText(){
  const last=localStorage.getItem(MC_MASTER_LAST);
  return last?new Date(last).toLocaleString('es-ES'):'Nunca';
}
function mcStartOfWeek(d){const x=new Date(d);const day=(x.getDay()+6)%7;x.setHours(0,0,0,0);x.setDate(x.getDate()-day);return x}
function mcIsoWeek(d){const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=x.getUTCDay()||7;x.setUTCDate(x.getUTCDate()+4-day);const y0=new Date(Date.UTC(x.getUTCFullYear(),0,1));return {year:x.getUTCFullYear(),week:Math.ceil((((x-y0)/86400000)+1)/7)}}
function mcNextWeek(d){const x=new Date(d);x.setDate(x.getDate()+7);return x}
function mcGcdId(url){const m=String(url||'').match(/\/(\d+)\/?$/);return m?m[1]:''}
function mcCountryES(v){v=String(v||'').trim().toLowerCase();return ['es','esp','spain','españa'].includes(v)}
async function mcFetchJson(url){const r=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store'});if(r.status===429)throw Error('La fuente ha alcanzado temporalmente su límite de consultas. Vuelve a pulsar Actualizar Maestro más adelante.');if(!r.ok)throw Error('Error '+r.status+' consultando '+url);return r.json()}
async function mcFetchPaged(url,maxPages=5){let out=[],next=url,n=0;while(next&&n++<maxPages){const j=await mcFetchJson(next);if(Array.isArray(j)){out.push(...j);break}out.push(...(j.results||[]));next=j.next||null}return out}
function mcMasterSig(x){return [x.publisher,x.catalogHeader||x.series,x.startYear,x.issueNr||x.issue].map(v=>norm(v||'')).join('|')}
async function mcGcdMasterRecord(summary,series,publisher){
  const issueUrl=summary.api_url||summary.url||'';let d=summary;
  if(issueUrl){try{d=await mcFetchJson(issueUrl)}catch{}}
  const sid=mcGcdId(d.api_url||issueUrl)||mcGcdId(String(d.id||''));
  const rec=cleanComic({
    id:sid?'gcd_'+sid:('gcd_'+crypto.randomUUID()),
    publisher:publisher?.name||publisher?.publisher_name||'',
    catalogHeader:series?.name||d.series_name||'',series:series?.name||d.series_name||'',
    volume:d.volume||'',stage:'',startYear:series?.year_began||'',
    issueNr:d.number||String(d.descriptor||summary.descriptor||'').match(/#?\s*([0-9]+(?:[.,][0-9]+)?[A-Za-z]?)\b/)?.[1]||'',
    title:d.title||d.descriptor||summary.descriptor||'',
    isbn:d.isbn||d.barcode||'',publicationDate:d.publication_date||summary.publication_date||'',
    pages:d.page_count||summary.page_count||'',color:series?.color||'',format:series?.binding||series?.publishing_format||'',
    coverUrl:d.cover||'',status:'',tags:'',price:d.price||summary.price||''
  });
  return {...rec,source:'Grand Comics Database',sourceId:sid||'',sourceUrl:issueUrl||'',country:'ES',lastSourceUpdate:new Date().toISOString()};
}
async function mcMergeMasterRows(rows){
  const existing=await allStore('master'),bySource=new Map(),bySig=new Map();
  existing.forEach(x=>{if(x.sourceId)bySource.set(String(x.sourceId),x);bySig.set(mcMasterSig(x),x)});
  let added=0,updated=0;
  for(const r of rows){
    const prev=(r.sourceId&&bySource.get(String(r.sourceId)))||bySig.get(mcMasterSig(r));
    if(prev){await putStore('master',{...prev,...r,id:prev.id,coverVaultKey:prev.coverVaultKey||r.coverVaultKey||''});updated++}
    else{await putStore('master',r);added++}
  }
  return {added,updated};
}
async function mcEnsureMasterBase(){
  let m=await allStore('master');
  if(m.length)return m;
  const c=await allStore('comics');
  if(!c.length)return [];
  busy(true,'Creando base inicial del Maestro…');
  try{
    const seed=c.map(x=>({...mcMasterRecord(x),source:'Base inicial',country:'ES',lastSourceUpdate:new Date().toISOString()}));
    await bulkPut('master',seed);return seed;
  }finally{busy(false)}
}
masterView=async function(){
  await mcEnsureMasterBase();
  let html=await mcMasterViewV16();
  const count=(await allStore('master')).length;
  const controls=`<div class="master-update-card"><div><b>Maestro España</b><span>${count.toLocaleString('es-ES')} referencias guardadas · Última actualización: ${esc(mcMasterStatusText())}</span><small>Actualizar añade/corrige publicaciones del mercado español sin modificar tu Catálogo ni borrar descatalogados.</small></div><div class="master-update-actions"><button class="btn primary" onclick="mcUpdateMasterSpain()">↻ Actualizar Maestro</button><span id="masterUpdateStatus" class="small muted"></span></div></div>`;
  return html.replace('<div class="panel">',controls+'<div class="panel">');
};
async function mcUpdateMasterSpain(){
  const status=document.getElementById('masterUpdateStatus');
  const now=new Date(),lastWeek=localStorage.getItem(MC_MASTER_WEEK);
  let start;
  if(lastWeek){start=new Date(lastWeek+'T00:00:00');start=mcNextWeek(start)}else{start=mcStartOfWeek(new Date(now.getTime()-56*86400000))}
  const weeks=[];for(let d=mcStartOfWeek(start);d<=mcStartOfWeek(now)&&weeks.length<MC_MASTER_MAX_WEEKS;d=mcNextWeek(d))weeks.push(new Date(d));
  if(!weeks.length){localStorage.setItem(MC_MASTER_LAST,new Date().toISOString());if(status)status.textContent='Ya está actualizado.';return toast('El Maestro ya está actualizado')}
  busy(true,'Actualizando Maestro España…');
  let totalAdded=0,totalUpdated=0,seriesCache=new Map(),pubCache=new Map();
  try{
    for(let wi=0;wi<weeks.length;wi++){
      const w=mcIsoWeek(weeks[wi]);if(status)status.textContent=`Semana ${w.week}/${w.year} (${wi+1}/${weeks.length})…`;
      const summaries=await mcFetchPaged(`https://www.comics.org/api/issue/on_sale_weekly/${w.year}/week/${w.week}/`,4);
      const rows=[];
      for(const s of summaries){
        const seriesUrl=s.series||'';if(!seriesUrl)continue;
        let ser=seriesCache.get(seriesUrl);if(!ser){try{ser=await mcFetchJson(seriesUrl);seriesCache.set(seriesUrl,ser)}catch{continue}}
        if(!mcCountryES(ser.country))continue;
        let pub={};if(ser.publisher){pub=pubCache.get(ser.publisher);if(!pub){try{pub=await mcFetchJson(ser.publisher);pubCache.set(ser.publisher,pub)}catch{pub={}}}}
        rows.push(await mcGcdMasterRecord(s,ser,pub));
      }
      const r=await mcMergeMasterRows(rows);totalAdded+=r.added;totalUpdated+=r.updated;
      localStorage.setItem(MC_MASTER_WEEK,weeks[wi].toISOString().slice(0,10));
    }
    localStorage.setItem(MC_MASTER_LAST,new Date().toISOString());
    toast(`Maestro actualizado: ${totalAdded} altas y ${totalUpdated} revisiones`);
    await render();
  }catch(e){console.error(e);toast(e.message||String(e));if(status)status.textContent=e.message||String(e)}finally{busy(false)}
}
