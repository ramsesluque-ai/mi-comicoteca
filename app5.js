async function parseXlsx(file){const files=await unzipXlsx(await file.arrayBuffer()),ss=[];if(files['xl/sharedStrings.xml'])xmlText(files['xl/sharedStrings.xml']).querySelectorAll('si').forEach(si=>ss.push([...si.querySelectorAll('t')].map(t=>t.textContent).join('')));const wb=xmlText(files['xl/workbook.xml']),rels=xmlText(files['xl/_rels/workbook.xml.rels']),rm={};rels.querySelectorAll('Relationship').forEach(r=>rm[r.getAttribute('Id')]=r.getAttribute('Target'));let best=[];for(const sh of wb.querySelectorAll('sheet')){const rid=sh.getAttribute('r:id')||sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),target=rm[rid];if(!target)continue;const path='xl/'+target.replace(/^\//,'').replace(/^xl\//,''),x=files[path];if(!x)continue;const d=xmlText(x),grid=[];d.querySelectorAll('row').forEach(row=>{const rr=[];row.querySelectorAll('c').forEach(c=>{const ref=c.getAttribute('r')||'',col=ref.match(/[A-Z]+/)?.[0]||'A';let idx=0;for(const ch of col)idx=idx*26+ch.charCodeAt(0)-64;idx--;const t=c.getAttribute('t'),v=c.querySelector('v')?.textContent||'',iv=c.querySelector('is t')?.textContent;rr[idx]=t==='s'?ss[+v]:t==='inlineStr'?iv:v});grid.push(rr)});const objs=rowsToObjects(grid);if(objs.length>best.length)best=objs}return best}
function mcImportParseCsv(text){
 const first=(text.replace(/^\\uFEFF/,'').split(/\\r?\\n/,1)[0]||'');
 const delimiter=[';',',','\\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows=[],out=[];let cell='',row=[],quoted=false;
 const src=text.replace(/^\\uFEFF/,'');
 for(let i=0;i<src.length;i++){const ch=src[i];if(ch==='"'){if(quoted&&src[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
 else if(ch===delimiter&&!quoted){row.push(cell);cell=''}
 else if((ch==='\\n'||ch==='\\r')&&!quoted){if(ch==='\\r'&&src[i+1]==='\\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=''}
 else cell+=ch}
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 if(!rows.length)return out;const headers=rows.shift().map(x=>x.trim());
 for(const values of rows){const obj={};headers.forEach((key,i)=>obj[key]=values[i]||'');out.push(obj)}return out;
}
function mcImportMap(raw){
 const aliases={publisher:['publisher','editorial','publisher name'],catalogHeader:['catalogheader','cabecera','coleccion','colección','serie','series'],volume:['volume','volumen'],stage:['stage','etapa','subserie'],startYear:['startyear','año inicio','ano inicio','año de inicio'],issueNr:['issuenr','issue','numero','número','num','nº'],title:['title','titulo','título','nombre'],subtitle:['subtitle','subtitulo','subtítulo'],isbn:['isbn','ean','codigo','código'],status:['status','estado'],tags:['tags','etiquetas','tag'],coverUrl:['coverurl','portada','url portada'],publicationDate:['publicationdate','fecha publicacion','fecha publicación'],authors:['authors','autores'],notes:['notes','notas'],location:['location','ubicacion','ubicación'],paid:['paid','precio pagado'],estimated:['estimated','valor estimado'],read:['read','leido','leído'],format:['format','formato'],pages:['pages','paginas','páginas']};
 const normalize=k=>String(k).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[_\\s-]+/g,' ').trim();
 const keys=Object.keys(raw),obj={};
 for(const [field,terms] of Object.entries(aliases)){const key=keys.find(k=>terms.some(t=>normalize(k)===normalize(t)));if(key&&raw[key]!==undefined)obj[field]=raw[key]}
 if(typeof obj.authors==='string')obj.authors={writer:obj.authors};
 if(obj.status){const st=normalize(obj.status);obj.status=/wishlist|deseos|wish list/.test(st)?'On Wish List':/coleccion|collection|tengo/.test(st)?'In Collection':obj.status}
 return cleanComic(obj);
}
function mcImportKey(x){const n=v=>String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim();return [n(x.publisher),n(x.catalogHeader||x.series),n(x.volume),n(x.stage),n(x.startYear),n(x.issueNr||x.issue),n(x.isbn)].join('|')}
let mcImportPending=null;
async function importFile(file,target='comics'){
 if(!file)return;
 busy(true,'Leyendo '+file.name+'…');
 try{
  if(!/\\.(json|csv|xlsx)$/i.test(file.name))throw Error('Formato no admitido: utiliza CSV, XLSX o JSON');
  let raw=[],backup=null;
  if(/\\.json$/i.test(file.name)){const parsed=JSON.parse(await file.text());if(Array.isArray(parsed))raw=parsed;else if(parsed&&Array.isArray(parsed.comics)){raw=parsed.comics;backup=parsed}else if(parsed&&Array.isArray(parsed.master))raw=parsed.master;else throw Error('JSON sin lista de cómics reconocible')}
  else if(/\\.xlsx$/i.test(file.name))raw=await parseXlsx(file);
  else raw=mcImportParseCsv(await file.text());
  if(!raw.length)throw Error('No se encontraron cómics en el archivo');
  if(raw.length>100000)throw Error('Importación demasiado grande: divide el archivo en bloques de 100.000');
  const rows=raw.map(mcImportMap).filter(x=>x.publisher&&(x.catalogHeader||x.series));
  const rejected=raw.length-rows.length;
  const existing=await allStore(target),existingKeys=new Set(existing.map(mcImportKey)),seen=new Set();
  const unique=[],duplicates=[];
  for(const x of rows){const key=mcImportKey(x);if(seen.has(key)||existingKeys.has(key))duplicates.push(x);else{seen.add(key);unique.push(x)}}
  mcImportPending={file:file.name,target,unique,duplicates,rejected,backup};
  const modal=document.getElementById('modal');
  modal.innerHTML=`<div class="modalbox"><div class="modalhead"><div><b>Vista previa de importación</b><div class="muted small">${esc(file.name)}</div></div><button class="btn" onclick="closeModal()">Cerrar</button></div><div class="modalbody"><p><b>${raw.length.toLocaleString('es-ES')}</b> filas leídas · <b>${unique.length.toLocaleString('es-ES')}</b> nuevas · <b>${duplicates.length.toLocaleString('es-ES')}</b> duplicadas · <b>${rejected}</b> sin editorial/cabecera.</p><p class="muted">Solo se añadirán registros nuevos. No se borrarán ni sobrescribirán fichas existentes. Los duplicados se omiten.</p><div style="max-height:260px;overflow:auto"><table><thead><tr><th>Editorial</th><th>Cabecera</th><th>Número</th><th>Estado</th></tr></thead><tbody>${unique.slice(0,30).map(x=>`<tr><td>${esc(x.publisher)}</td><td>${esc(x.catalogHeader)}</td><td>${esc(x.issueNr)}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody></table></div><div class="actions" style="margin-top:18px"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="mcImportConfirm()">Importar ${unique.length.toLocaleString('es-ES')} nuevos</button></div></div></div>`;
  modal.classList.add('show');
 }catch(e){console.error(e);toast('Error de importación: '+(e.message||e))}finally{busy(false)}
}
async function mcImportConfirm(){
 const pending=mcImportPending;if(!pending)return;
 mcImportPending=null;
 if(!pending.unique.length){closeModal();toast('No hay registros nuevos');return}
 busy(true,'Importando fichas…');
 try{await bulkPut(pending.target,pending.unique.map(x=>({...x,id:uuid(pending.target==='master'?'m':'c')})));closeModal();toast('Importados '+pending.unique.length.toLocaleString('es-ES')+' cómics nuevos');await render()}
 catch(e){console.error(e);toast('Error al guardar: '+(e.message||e))}
 finally{busy(false)}
}
function mcImportTemplate(){
 const columns=['Editorial','Cabecera','Volumen','Etapa','Año de inicio','Número','Título','ISBN','Estado','Tags','URL portada','Autores','Notas'];
 const example=['ECC','Batman','','','2016','1','Batman','9780000000000','En colección','Completa','','',''];
 const quote=x=>'"'+String(x).replace(/"/g,'""')+'"';
 download('COMICTECA_plantilla_importacion.csv','\\uFEFF'+columns.map(quote).join(';')+'\\n'+example.map(quote).join(';')+'\\n','text/csv;charset=utf-8');
}
async function backupView(){const c=await allStore('comics'),m=await allStore('master'),p=await allStore('purchases');return head('Datos / copias','Importación, copias locales y portabilidad de tus datos.')+`<div class="chartrow"><div class="card"><h3>Importar colección desde fichero</h3><p class="muted">CSV, Excel (.xlsx) o JSON. Vista previa obligatoria, detección de duplicados y carga solo de fichas nuevas. Nunca se borrará tu colección.</p><button class="btn" onclick="mcImportTemplate()">Descargar plantilla CSV</button><p class="small muted">Puedes importar también copias JSON, sin sustituir los datos existentes. Guarda una copia antes de realizar cargas grandes.</p><label class="btn primary">Importar colección<input class="hidden" type="file" accept=".json,.csv,.xlsx" onchange="importFile(this.files[0],'comics');this.value='' "></label><h3 style="margin-top:22px">Maestro</h3><p class="muted">Importa un Maestro separado desde JSON, CSV o XLSX. Se añadirá al catálogo maestro local.</p><label class="btn">Importar Maestro<input class="hidden" type="file" accept=".json,.csv,.xlsx" onchange="importFile(this.files[0],'master');this.value='' "></label></div><div class="card"><h3>Copia completa</h3><p class="muted">Guarda una copia local después de cambios importantes. Puedes trasladarla a otro dispositivo sin depender de la sincronización.</p><button class="btn primary" onclick="exportBackup()">Exportar copia JSON</button> <button class="btn" onclick="exportCSV()">Exportar catálogo CSV</button><div class="statsbar" style="margin-top:18px"><span class="statmini">${c.length.toLocaleString('es-ES')} cómics</span><span class="statmini">${m.length.toLocaleString('es-ES')} maestro</span><span class="statmini">${p.length} compras</span></div><div class="notice oknotice" style="margin-top:18px"><b>Copia local.</b> Esta exportación se descarga en tu dispositivo. Si tienes sincronización en la nube activada, verifica su estado por separado: exportar no sustituye la sincronización ni confirma una copia remota.</div><button class="btn danger" onclick="resetAll()">Borrar datos de este dispositivo</button></div></div>`}
async function exportBackup(){const data={app:'MI COMICOTECA',version:3,exportedAt:new Date().toISOString(),comics:await allStore('comics'),purchases:await allStore('purchases'),master:await allStore('master')};download('MI_COMICOTECA_BACKUP_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(data),'application/json')}
async function exportCSV(){const rows=await allStore('comics'),cols=['publisher','catalogHeader','volume','stage','startYear','series','issueNr','format','status','tags','group','arc','subtitle','title','isbn','legalDeposit','publicationDate','pages','color','edition','coverUrl','purchaseDate','paid','estimated','condition','location','read','priority','seller','review','notes'],q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';download('MI_COMICOTECA_CATALOGO.csv','\ufeff'+cols.join(';')+'\n'+rows.map(r=>cols.map(c=>q(r[c])).join(';')).join('\n'),'text/csv;charset=utf-8')}
async function resetAll(){if(!confirm('¿Borrar colección, maestro y compras guardados en ESTE dispositivo? Exporta antes una copia si la necesitas.'))return;for(const s of ['comics','master','purchases'])await clearStore(s);toast('Datos locales borrados');await render()}
async function render(){let html='';if(current==='dashboard')html=await (window.PbiDashboard&&typeof window.PbiDashboard.view==='function'?window.PbiDashboard.view():dashboard());if(current==='catalog')html=await catalogView(false);if(current==='wishlist')html=await catalogView(true);if(current==='series')html=await seriesView();if(current==='master')html=await masterView();if(current==='purchases')html=await purchasesView();if(current==='quality')html=await quality();if(current==='stats')html=await stats();if(current==='backup')html=await backupView();$('#view').innerHTML=html;if(current==='catalog')await renderCat(false);if(current==='wishlist')await renderCat(true);if(current==='series')await renderSeries();if(current==='master'&&(await allStore('master')).length)await renderMaster()}
window.onclick=e=>{if(e.target.id==='modal')closeModal()};window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').classList.add('hidden')}};
function startupFailure(stage,e){console.error('[COMICTECA startup:'+stage+']',e);const view=document.querySelector('#view')||document.body;const msg=stage==='storage'?'No se ha podido acceder al almacenamiento local en este navegador. Tus datos no se han borrado. Cierra otras pestañas de COMICTECA y vuelve a intentarlo.':'La aplicación no ha podido completar el arranque. Tus datos locales no se han borrado.';view.innerHTML=`<div class="card" style="margin:24px;max-width:760px"><h2>No se pudo iniciar COMICTECA</h2><p>${msg}</p><p class="muted">Detalle técnico: ${String(e&&e.message||e||'Error desconocido').replace(/[<>&]/g,s=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</p><button class="btn primary" onclick="location.reload()">Reintentar</button></div>`}
(async()=>{try{await openDB()}catch(e){startupFailure('storage',e);return}if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(e=>console.warn('[COMICTECA service worker]',e));try{await render()}catch(e){startupFailure('render',e)}})();
