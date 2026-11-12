'use strict';
/* Navegador del Maestro España masivo. Carga por editorial para no volcar todas las filas en memoria. */
const MCMasterUI={rows:[],publisher:'',collectionKey:'',loadedPublisher:'',activeIssueRows:[],visibleGroups:new Map()};

let mcNovedadesArchivePromise=null;
let mcManualAdditionsPromise=null;
async function mcManualAdditions(){
 if(!mcManualAdditionsPromise)mcManualAdditionsPromise=fetch('master-data/manual-additions.json?v=20261112',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('No se pudo cargar ampliaciones del Maestro');return r.json()}).then(j=>Array.isArray(j.items)?j.items:[]).catch(e=>{console.warn(e);return[]});
 return mcManualAdditionsPromise;
}
async function mcNovedadesArchive(){
 if(!mcNovedadesArchivePromise)mcNovedadesArchivePromise=fetch('master-data/novedades-archive.json?v=20261111',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('No se pudo cargar archivo de novedades');return r.json()}).then(j=>(j.items||[]).map(r=>({...r,id:'nov-'+r.id,catalogHeader:r.series||r.title,series:r.series||r.title,issueNr:r.issueNr||'Único',startYear:r.startYear||String(r.publicationDate||r.releaseMonth||'').slice(0,4),coverUrl:r.coverUrl||''}))).catch(e=>{console.warn(e);return[]});
 return mcNovedadesArchivePromise;
}
async function mcMasterIndexWithArchive(){
 const base=await mcSEMasterIndex(),archive=await mcNovedadesArchive(),idx={...base,publishers:(base.publishers||[]).map(p=>({...p}))};
 const count=new Map();
 for(const r of archive)count.set(r.publisher,(count.get(r.publisher)||0)+1);
 for(const [name,n] of count){let p=idx.publishers.find(x=>x.publisher===name);if(!p){p={publisher:name,issues:0,series:0,chunks:[],priority:0};idx.publishers.push(p)}p.issues+=n}
 idx.totalIssues=base.totalIssues+archive.length;
 idx.totalPublishers=idx.publishers.length;
 return idx;
}
function mcMasterCode(r){return mcSECode(r?.isbn||r?.barcode||'')}
// Verified bibliographic corrections keyed by the original GCD record ID, not by ISBN.
// Dates below identify publication month only; no invented day or ISBN.
const MC_VERIFIED_MASTER_RECORDS={
 'gcd_1171852':{title:'100 Balas · Tomo 1',publicationDate:'2013-12',pages:'240'},
 'gcd_1171853':{title:'100 Balas · Tomo 2',publicationDate:'2014-02',pages:'240'},
 'gcd_1171854':{title:'100 Balas · Tomo 3',publicationDate:'2014-04',pages:'240'},
 'gcd_1171855':{title:'100 Balas · Tomo 4',publicationDate:'2014-06',pages:'240'},
 'gcd_1171856':{title:'100 Balas · Tomo 5',publicationDate:'2014-08',pages:'240'},
 'gcd_1171857':{title:'100 Balas · Tomo 6',publicationDate:'2014-10',pages:'240'},
 'gcd_1171858':{title:'100 Balas · Tomo 7',publicationDate:'2014-12',pages:'240'},
 'gcd_1171859':{title:'100 Balas · Tomo 8',publicationDate:'2015-02',pages:'240'},
 'gcd_1171860':{title:'100 Balas · Tomo 9',publicationDate:'2015-04',pages:'240'},
 'gcd_1171861':{title:'100 Balas · Tomo 10',publicationDate:'2015-06',pages:'248'},
 'gcd_2398600':{title:'100 Balas · Tomo 1',pages:'460'},
 'gcd_2398601':{title:'100 Balas · Tomo 2',pages:'420'},
 'gcd_2398602':{title:'100 Balas · Tomo 3',pages:'420'},
 'gcd_2398603':{title:'100 Balas · Tomo 4',pages:'420'},
 'gcd_2398604':{title:'100 Balas · Tomo 5',pages:'420'},
 'gcd_2240211':{title:'Adam y Eve · Tomo 1',pages:'298'},
 'gcd_2240212':{title:'Adam y Eve · Tomo 2',pages:'298'},
 'gcd_1171657':{title:'American Vampire · Tomo 1'},
 'gcd_2225992':{title:'American Vampire · Tomo 1'},
 'gcd_1171658':{title:'American Vampire · Tomo 2'},
 'gcd_2225993':{title:'American Vampire · Tomo 2'},
 'gcd_1186326':{title:'American Vampire · Tomo 3'},
 'gcd_942535':{title:'American Vampire · Tomo 3'},
 'gcd_1051563':{title:'American Vampire · Tomo 4'},
 'gcd_1186327':{title:'American Vampire · Tomo 4'},
 'gcd_1186328':{title:'American Vampire · Tomo 5'},
 'gcd_1186441':{title:'American Vampire · Tomo 5'},
 'gcd_1186329':{title:'American Vampire · Tomo 6'},
 'gcd_1186442':{title:'American Vampire · Tomo 6'},
 'gcd_2225994':{title:'American Vampire · Tomo 7'},
 'gcd_2255790':{title:'American Vampire · Tomo 7'},
 'gcd_2225995':{title:'American Vampire · Tomo 8'},
 'gcd_2255791':{title:'American Vampire · Tomo 8'},
 'gcd_2240232':{title:'Animal Man: El Reino Rojo',issueNr:'Tomo único',publicationDate:'2020'},
 'gcd_1048626':{title:'Antes de Watchmen: Búho Nocturno · N.º 1'},
 'gcd_1048627':{title:'Antes de Watchmen: Búho Nocturno · N.º 2'},
 'gcd_1099886':{title:'Antes de Watchmen: Búho Nocturno · N.º 3'},
 'gcd_1099887':{title:'Antes de Watchmen: Búho Nocturno · N.º 4'},
 'gcd_1172212':{title:'Antes de Watchmen: Dollar Bill',issueNr:'Número único',publicationDate:'2013-05',pages:'32'},
 'gcd_1250910':{title:'Antes de Watchmen: Dr. Manhattan · N.º 1',pages:'36'},
 'gcd_1250911':{title:'Antes de Watchmen: Dr. Manhattan · N.º 2',pages:'36'},
 'gcd_1250912':{title:'Antes de Watchmen: Dr. Manhattan · N.º 3',pages:'36'},
 'gcd_1250913':{title:'Antes de Watchmen: Dr. Manhattan · N.º 4',pages:'36'},
 'gcd_1656717':{title:'Antes de Watchmen: Dr. Manhattan · Vol. 2',issueNr:'Número único',publicationDate:'2016-11',pages:'120',isbn:'9788416945054'},
 'gcd_1048622':{title:'Antes de Watchmen: El Comediante · N.º 1'},
 'gcd_1048623':{title:'Antes de Watchmen: El Comediante · N.º 2'},
 'gcd_1171896':{title:'Antes de Watchmen: El Comediante · N.º 3'},
 'gcd_1171897':{title:'Antes de Watchmen: El Comediante · N.º 4'},
 'gcd_1171898':{title:'Antes de Watchmen: El Comediante · N.º 5'},
 'gcd_1171899':{title:'Antes de Watchmen: El Comediante · N.º 6'},
 'gcd_1048633':{title:'Antes de Watchmen: Espectro de Seda · N.º 1'},
 'gcd_1048634':{title:'Antes de Watchmen: Espectro de Seda · N.º 2'},
 'gcd_1171900':{title:'Antes de Watchmen: Espectro de Seda · N.º 3'},
 'gcd_1171901':{title:'Antes de Watchmen: Espectro de Seda · N.º 4'},
 'gcd_1036701':{title:'Antes de Watchmen: Minutemen · N.º 1'},
 'gcd_1048625':{title:'Antes de Watchmen: Minutemen · N.º 2'},
 'gcd_1171902':{title:'Antes de Watchmen: Minutemen · N.º 3'},
 'gcd_1171903':{title:'Antes de Watchmen: Minutemen · N.º 4'},
 'gcd_1171904':{title:'Antes de Watchmen: Minutemen · N.º 5'},
 'gcd_1171905':{title:'Antes de Watchmen: Minutemen · N.º 6'},
 'gcd_1171661':{title:'Antes de Watchmen: Moloch · N.º 1',pages:'32'},
 'gcd_1171662':{title:'Antes de Watchmen: Moloch · N.º 2',pages:'32'},
 'gcd_1048631':{title:'Antes de Watchmen: Ozymandias · N.º 1'},
 'gcd_1048632':{title:'Antes de Watchmen: Ozymandias · N.º 2'},
 'gcd_1171906':{title:'Antes de Watchmen: Ozymandias · N.º 3'},
 'gcd_1171907':{title:'Antes de Watchmen: Ozymandias · N.º 4'},
 'gcd_1171908':{title:'Antes de Watchmen: Ozymandias · N.º 5'},
 'gcd_1171909':{title:'Antes de Watchmen: Ozymandias · N.º 6'}
};
async function mcMasterEnrichRows(rows){const over=await mcSEOverrides();const shared=await window.mcSharedCovers?.()||{};return rows.map(r=>{const o={...(MC_VERIFIED_MASTER_RECORDS[String(r.id)]||{}),...(over[mcMasterCode(r)]||{})},common=shared[window.mcMasterCoverKey?.(r)||'']||'';return{...r,title:o.title||r.title||'',publisher:o.publisher||r.publisher||'',catalogHeader:o.series||r.catalogHeader||r.series||'',series:o.series||r.series||r.catalogHeader||'',issueNr:o.issueNr||r.issueNr||r.issue||'',issue:o.issueNr||r.issue||r.issueNr||'',publicationDate:(v=>v==='-1'||v==='-1-00'||v==='0000-00-00'?'':v)(String(o.publicationDate||r.publicationDate||'').trim()),pages:o.pages||r.pages||'',isbn:o.isbn||r.isbn||'',coverUrl:common||o.coverUrl||r.coverUrl||'',sourceUrl:o.sourceUrl||r.sourceUrl||''}})}
async function mcMasterLoadPublisher(pub){if(MCMasterUI.loadedPublisher===pub&&MCMasterUI.rows.length)return MCMasterUI.rows;const idx=await mcMasterIndexWithArchive(),meta=(idx.publishers||[]).find(p=>p.publisher===pub)||mcSEPublisherMeta(idx,pub)[0];if(!meta){MCMasterUI.rows=[];MCMasterUI.loadedPublisher='';return[]}const rows=await mcSEChunks(meta.chunks||[]);
 const archive=(await mcNovedadesArchive()).filter(r=>r.publisher===pub);
 const manual=(await mcManualAdditions()).filter(r=>r.publisher===pub);
 const key=r=>String(r.isbn||'').replace(/[^0-9X]/gi,'')||[mcSENorm(r.publisher),mcSENorm(r.catalogHeader||r.series),mcSENorm(r.volume||''),mcSENorm(r.stage||''),String(r.startYear||''),mcSENorm(r.issueNr||r.issue||'Único')].join('|');
 const existing=new Set(rows.map(key));
 for(const r of [...archive,...manual]){const k=key(r);if(!existing.has(k)){rows.push(r);existing.add(k)}}
 MCMasterUI.rows=await mcMasterEnrichRows(rows);MCMasterUI.loadedPublisher=meta.publisher;return MCMasterUI.rows}
function mcMasterGroupKey(r){return [mcSENorm(r.publisher),mcSENorm(r.catalogHeader||r.series),String(r.volume||''),mcSENorm(r.stage||''),String(r.startYear||'')].join('|')}
function mcMasterGroupLabel(r){return [r.catalogHeader||r.series,r.volume&&('Vol. '+r.volume),r.stage,r.startYear].filter(Boolean).join(' · ')}
function mcMasterIssueSort(a,b){const A=String(a.issueNr||a.issue||''),B=String(b.issueNr||b.issue||''),na=parseFloat(A),nb=parseFloat(B);if(Number.isFinite(na)&&Number.isFinite(nb)&&na!==nb)return na-nb;return A.localeCompare(B,'es',{numeric:true})}

masterView=async function(){const idx=await mcMasterIndexWithArchive();return head('Maestro España',`${idx.totalIssues.toLocaleString('es-ES')} ejemplares · ${idx.totalSeries.toLocaleString('es-ES')} series · ${idx.totalPublishers.toLocaleString('es-ES')} editoriales · snapshot ${idx.snapshot}`,`<button class="btn" onclick="filters={};page=1;render()">Limpiar filtros</button>`)+`<div class="notice oknotice"><b>Maestro bibliográfico independiente.</b> Se carga por editorial y la búsqueda de ficha consulta estos datos directamente, sin lanzar búsquedas por Internet ni procesos de GitHub Actions.</div><div class="panel"><div class="filters master-static-filters"><input id="mq" value="${esc(filters.q||'')}" placeholder="Buscar editorial, cabecera, título o ISBN…"><select id="mpub"><option value="">Todas las editoriales (${idx.totalPublishers})</option>${(idx.publishers||[]).map(p=>`<option value="${esc(p.publisher)}" ${filters.publisher===p.publisher?'selected':''}>${esc(p.publisher)} · ${p.issues.toLocaleString('es-ES')}</option>`).join('')}</select></div><div id="masterbody"><div class="muted">Cargando Maestro…</div></div></div>`}

renderMaster=async function(){const body=$('#masterbody');if(!body)return;const idx=await mcMasterIndexWithArchive(),pub=$('#mpub')?.value||filters.publisher||'',q=mcSENorm($('#mq')?.value||filters.q||'');filters.publisher=pub;filters.q=$('#mq')?.value||'';if(!pub){let pubs=(idx.publishers||[]).filter(p=>!q||mcSENorm(p.publisher).includes(q)).sort((a,b)=>(b.priority-a.priority)||b.issues-a.issues||a.publisher.localeCompare(b.publisher,'es'));const per=48,pages=Math.max(1,Math.ceil(pubs.length/per));page=Math.min(page,pages);const slice=pubs.slice((page-1)*per,page*per);body.innerHTML=`<div class="master-grid visual publisher-master-grid">${slice.map(p=>`<article class="master-card visual publisher-card" onclick="mcMasterChoosePublisher('${esc(p.publisher).replace(/'/g,"\\'")}')"><div class="master-content"><div class="comic-kicker">${p.priority?'Editorial prioritaria':'Editorial España'}</div><div class="master-title">${esc(p.publisher)}</div><div class="master-count"><b>${p.issues.toLocaleString('es-ES')}</b> ejemplares · <b>${p.series.toLocaleString('es-ES')}</b> series</div><div class="master-meta">${p.chunks.length} bloque${p.chunks.length===1?'':'s'} de datos</div><button class="btn primary">Explorar editorial</button></div></article>`).join('')}</div><div class="pager"><span>${pubs.length.toLocaleString('es-ES')} editoriales · Página ${page}/${pages}</span><span><button class="btn sm" ${page<=1?'disabled':''} onclick="page--;renderMaster()">Anterior</button> <button class="btn sm" ${page>=pages?'disabled':''} onclick="page++;renderMaster()">Siguiente</button></span></div>`}else{body.innerHTML='<div class="muted">Cargando '+esc(pub)+'…</div>';const rows=await mcMasterLoadPublisher(pub),ownedRows=await allStore('comics'),owned=new Set(ownedRows.map(x=>[mcMasterGroupKey(x),String(x.issueNr||x.issue||'')].join('|'))),groups=new Map();for(const r of rows){if(q&&!mcSENorm([r.catalogHeader,r.series,r.title,r.isbn,r.issueNr,r.startYear].join(' ')).includes(q))continue;const k=mcMasterGroupKey(r);if(!groups.has(k))groups.set(k,{sample:r,count:0,cover:null,owned:0});const g=groups.get(k);g.count++;if(!g.cover&&r.coverUrl)g.cover=r;if(owned.has([k,String(r.issueNr||r.issue||'')].join('|')))g.owned++}let arr=[...groups.entries()].sort((a,b)=>mcMasterGroupLabel(a[1].sample).localeCompare(mcMasterGroupLabel(b[1].sample),'es',{numeric:true}));const per=60,pages=Math.max(1,Math.ceil(arr.length/per));page=Math.min(page,pages);const slice=arr.slice((page-1)*per,page*per);body.innerHTML=`<div class="master-summary-strip"><span><b>${esc(pub)}</b></span><span>${rows.length.toLocaleString('es-ES')} ejemplares</span><span>${arr.length.toLocaleString('es-ES')} colecciones/etapas</span></div><div class="master-grid visual">${slice.map(([k,g])=>{const s=g.cover||g.sample;return`<article class="master-card visual"><div class="master-cover">${img(s,'cover mastercover')}</div><div class="master-content"><div class="comic-kicker">${esc(g.sample.publisher)}</div><div class="master-title">${esc(g.sample.catalogHeader||g.sample.series)}</div><div class="master-meta">${esc([g.sample.volume&&('Vol. '+g.sample.volume),g.sample.stage,g.sample.startYear].filter(Boolean).join(' · ')||'Edición sin identificar')}</div><div class="master-count"><b>${g.count}</b> números${g.owned?` · <span class="pill in">${g.owned} tuyos</span>`:''}</div><button class="btn primary" onclick="openMasterCollection('${encodeURIComponent(k)}')">Ver números</button></div></article>`}).join('')||'<div class="empty">No hay resultados con estos filtros.</div>'}</div><div class="pager"><span>${arr.length.toLocaleString('es-ES')} colecciones · Página ${page}/${pages}</span><span><button class="btn sm" ${page<=1?'disabled':''} onclick="page--;renderMaster()">Anterior</button> <button class="btn sm" ${page>=pages?'disabled':''} onclick="page++;renderMaster()">Siguiente</button></span></div>`}const mq=$('#mq');if(mq)mq.oninput=()=>{filters.q=mq.value;page=1;renderMaster()};const mp=$('#mpub');if(mp)mp.onchange=()=>{filters.publisher=mp.value;filters.q='';if(mq)mq.value='';page=1;renderMaster()}}
function mcMasterChoosePublisher(pub){filters.publisher=pub;filters.q='';page=1;const s=$('#mpub');if(s)s.value=pub;const q=$('#mq');if(q)q.value='';renderMaster()}

function mcMasterIssueIdentity(r){
 // La fecha de publicación no identifica un número: distintas fuentes pueden
 // dar fechas diferentes para la misma edición. El ISBN solo diferencia variantes
 // cuando existen ISBN distintos y acreditados para el mismo número.
 const issue=String(r.issueNr??r.issue??'').trim().toLocaleLowerCase('es').replace(/[º°]/g,'').replace(/^0+(?=\\d)/,'');
 return issue||('sin-numero:'+String(r.id||''));
}
function mcMasterDistinctIssues(rows){
 const groups=new Map();
 for(const r of rows){
   const issue=mcMasterIssueIdentity(r),isbn=String(r.isbn||'').replace(/[^0-9X]/gi,'').toUpperCase();
   if(!groups.has(issue))groups.set(issue,[]);
   groups.get(issue).push({...r,_mcIsbn:isbn});
 }
 const out=[];
 const score=x=>(x.coverUrl?8:0)+(x.isbn?4:0)+(x.sourceUrl?2:0)+(x.title?1:0)+(x.publicationDate?1:0);
 for(const records of groups.values()){
   const known=new Map();
   for(const r of records){if(r._mcIsbn){const old=known.get(r._mcIsbn);if(!old||score(r)>score(old))known.set(r._mcIsbn,r)}}
   if(known.size>1){
     // ISBN distintos acreditan variantes de edición: conservarlas por separado.
     out.push(...known.values());
   }else{
     // Sin ISBN distinto no crear fichas repetidas por diferencias de fecha.
     out.push(records.reduce((best,r)=>!best||score(r)>score(best)?r:best,null));
   }
 }
 return out.sort(mcMasterIssueSort);
}

openMasterCollection=async function(encoded){const k=decodeURIComponent(encoded),cached=MCMasterUI.visibleGroups?.get(k),pub=cached?.publisher||filters.publisher||MCMasterUI.loadedPublisher,rows=cached?.rows?.length?cached.rows:await mcMasterLoadPublisher(pub),m=await mcMasterEnrichRows((cached?.rows?.length?cached.rows:rows.filter(x=>mcMasterGroupKey(x)===k)).slice().sort(mcMasterIssueSort)),sharedCovers=await window.mcSharedCovers?.(true)||{},coverKey=window.mcMasterCoverKey,coveredIssues=m.map(r=>{const key=coverKey?.(r)||'';const url=sharedCovers[key]||'';return url?{...r,coverUrl:url}:r}),c=await allStore('comics'),keys=new Set(c.map(x=>[mcMasterGroupKey(x),mcMasterIssueIdentity(x)].join('|'))),displayIssues=mcMasterDistinctIssues(coveredIssues),sample=coveredIssues[0];if(!sample)return toast('No se encontró la colección en el Maestro');MCMasterUI.collectionKey=k;MCMasterUI.activeIssueRows=m;MCMasterUI.loadedPublisher=pub;$('#modal').innerHTML=`<div class="modalbox"><div class="modalhead"><div><b>${esc([sample.publisher,mcMasterGroupLabel(sample)].filter(Boolean).join(' · '))}</b><div class="muted small">${displayIssues.length.toLocaleString('es-ES')} números distintos · ${m.length.toLocaleString('es-ES')} registros bibliográficos</div></div><button class="btn" onclick="closeModal()">Cerrar</button></div><div class="modalbody"><div class="issue-grid master-issues">${displayIssues.map(x=>{const exists=keys.has([k,mcMasterIssueIdentity(x)].join('|'));return`<article class="issue-card master-issue">${img(x,'cover issuecover')}<div class="issue-body"><div class="issue-no">${esc(x.publisher==='ECC'&&x.catalogHeader==='¡Batman y Robin deben Morir!'&&String(x.isbn)==='9788415844341'?'1.ª edición':x.publisher==='ECC'&&x.catalogHeader==='¡Batman y Robin deben Morir!'&&String(x.isbn)==='9788416303724'?'2.ª edición':issueNumberLabel(x))}</div><div class="issue-title">${esc(x.title||x.catalogHeader||'Sin título específico')}</div>${x.publicationDate?`<div class="muted small">${esc(x.publicationDate)}</div>`:''}${x.isbn?`<div class="muted small">ISBN ${esc(x.isbn)}</div>`:''}<div class="issue-actions">${exists?'<span class="pill in">Ya añadido</span>':`<button class="btn sm primary" onclick="addFromMaster('${esc(x.id)}','In Collection')">A colección</button><button class="btn sm" onclick="addFromMaster('${esc(x.id)}','On Wish List')">Wishlist</button>`}<button class="btn sm" onclick="mcProposeMasterCover('${encodeURIComponent(x.id)}')">Proponer portada</button></div></div></article>`}).join('')}</div></div></div>`;$('#modal').classList.remove('hidden')}

addFromMaster=async function(id,status){let x=(MCMasterUI.activeIssueRows||[]).find(r=>String(r.id)===String(id))||(MCMasterUI.rows||[]).find(r=>String(r.id)===String(id));if(!x){const pub=filters.publisher||MCMasterUI.loadedPublisher;if(pub){const rows=await mcMasterLoadPublisher(pub);x=rows.find(r=>String(r.id)===String(id));}}if(!x)return toast('No se encontró el ejemplar en el Maestro');const c=cleanComic({...x,id:uuid('c'),status});await putStore('comics',c);if(c.coverUrl&&window.CoverVault?.attach){try{await CoverVault.attach(c,c.coverUrl)}catch(e){console.warn('No se pudo fijar la portada en bóveda',e)}}toast(status==='In Collection'?'Añadido a colección':'Añadido a wishlist');await openMasterCollection(encodeURIComponent(MCMasterUI.collectionKey))};

;(function(){const s=document.createElement('style');s.textContent=`.publisher-master-grid .publisher-card{min-height:190px}.publisher-card .master-content{display:flex;flex-direction:column;gap:10px}.master-summary-strip{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 14px}.master-summary-strip span{padding:7px 11px;border:1px solid #28445f;border-radius:999px;background:#0b2034}.publisher-card{cursor:pointer}`;document.head.appendChild(s)})();
