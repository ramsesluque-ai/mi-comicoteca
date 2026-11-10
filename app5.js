async function parseXlsx(file){const files=await unzipXlsx(await file.arrayBuffer()),ss=[];if(files['xl/sharedStrings.xml'])xmlText(files['xl/sharedStrings.xml']).querySelectorAll('si').forEach(si=>ss.push([...si.querySelectorAll('t')].map(t=>t.textContent).join('')));const wb=xmlText(files['xl/workbook.xml']),rels=xmlText(files['xl/_rels/workbook.xml.rels']),rm={};rels.querySelectorAll('Relationship').forEach(r=>rm[r.getAttribute('Id')]=r.getAttribute('Target'));let best=[];for(const sh of wb.querySelectorAll('sheet')){const rid=sh.getAttribute('r:id')||sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),target=rm[rid];if(!target)continue;const path='xl/'+target.replace(/^\//,'').replace(/^xl\//,''),x=files[path];if(!x)continue;const d=xmlText(x),grid=[];d.querySelectorAll('row').forEach(row=>{const rr=[];row.querySelectorAll('c').forEach(c=>{const ref=c.getAttribute('r')||'',col=ref.match(/[A-Z]+/)?.[0]||'A';let idx=0;for(const ch of col)idx=idx*26+ch.charCodeAt(0)-64;idx--;const t=c.getAttribute('t'),v=c.querySelector('v')?.textContent||'',iv=c.querySelector('is t')?.textContent;rr[idx]=t==='s'?ss[+v]:t==='inlineStr'?iv:v});grid.push(rr)});const objs=rowsToObjects(grid);if(objs.length>best.length)best=objs}return best}
function mcImportParseCsv(text){
 const src=String(text||'').replace(/^\uFEFF/,'');
 const first=src.split(/\r?\n/,1)[0]||'';
 const delimiter=[';',',','\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows=[],out=[];let cell='',row=[],quoted=false;
 for(let i=0;i<src.length;i++){const ch=src[i];if(ch==='"'){if(quoted&&src[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
 else if(ch===delimiter&&!quoted){row.push(cell);cell=''}
 else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&src[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=''}
 else cell+=ch}
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 if(!rows.length)return out;const headers=rows.shift().map(x=>x.trim());
 for(const values of rows){const obj={};headers.forEach((key,i)=>obj[key]=values[i]||'');out.push(obj)}return out;
}
function mcImportMap(raw){
 const aliases={publisher:['publisher','editorial','publisher name'],catalogHeader:['catalogheader','cabecera','coleccion','colección','serie','series'],volume:['volume','volumen'],stage:['stage','etapa','subserie'],startYear:['startyear','año inicio','ano inicio','año de inicio'],issueNr:['issuenr','issue','numero','número','num','nº'],title:['title','titulo','título','nombre'],subtitle:['subtitle','subtitulo','subtítulo'],isbn:['isbn','ean','codigo','código'],status:['status','estado'],tags:['tags','etiquetas','tag'],coverUrl:['coverurl','portada','url portada'],publicationDate:['publicationdate','fecha publicacion','fecha publicación'],authors:['authors','autores'],notes:['notes','notas'],location:['location','ubicacion','ubicación'],paid:['paid','precio pagado'],estimated:['estimated','valor estimado'],read:['read','leido','leído'],format:['format','formato'],pages:['pages','paginas','páginas'],synopsis:['synopsis','sinopsis','resumen'],characters:['characters','personajes'],genre:['genre','genero','género'],arc:['arc','saga','arco'],originalEdition:['originaledition','edicion original','edición original'],equivalences:['equivalences','equivalencias'],ean:['ean'],price:['price','precio','precio de portada'],variants:['variants','variantes'],sources:['sources','fuentes','fuente'],sourceUpdatedAt:['sourceupdatedat','fecha actualizacion','fecha de actualización'],coverVariants:['covervariants','portadas alternativas'],condition:['condition','conservacion','conservación'],purchaseDate:['purchasedate','fecha compra','fecha de compra'],authorRoles:['authorroles','autores y roles','roles autores']};
 const normalize=k=>String(k).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_\\s-]+/g,' ').trim();
 const keys=Object.keys(raw),obj={};
 for(const [field,terms] of Object.entries(aliases)){const key=keys.find(k=>terms.some(t=>normalize(k)===normalize(t)));if(key&&raw[key]!==undefined)obj[field]=raw[key]}
 if(typeof obj.authors==='string')obj.authors={unclassified:obj.authors};
 if(typeof obj.authorRoles==='string'&&obj.authorRoles.trim())obj.authors={...(obj.authors||{}),unclassified:obj.authorRoles};
 delete obj.authorRoles;
 if(obj.status){const st=normalize(obj.status);obj.status=/wishlist|deseos|wish list/.test(st)?'On Wish List':/coleccion|collection|tengo/.test(st)?'In Collection':obj.status}
 return cleanComic(obj);
}
function mcImportKey(x){const n=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();return [n(x.publisher),n(x.catalogHeader||x.series),n(x.volume),n(x.stage),n(x.startYear),n(x.issueNr||x.issue),n(x.isbn)].join('|')}
// Detect incomplete collection identities without guessing their edition.
function mcImportIdentityConflict(a,b){
 const n=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(n(a.publisher)!==n(b.publisher)||n(a.catalogHeader||a.series)!==n(b.catalogHeader||b.series)||n(a.issueNr||a.issue)!==n(b.issueNr||b.issue))return false;
 const fields=['volume','stage','startYear'];
 return fields.some(k=>!n(a[k])||!n(b[k]))&&fields.every(k=>!n(a[k])||!n(b[k])||n(a[k])===n(b[k]));
}
let mcImportPending=null;
function mcImportStatus(message,isError=false){
 const el=document.getElementById('mcImportStatus');
 if(el){el.textContent=message;el.style.color=isError?'#ff9d9d':'#a9dbe6';el.setAttribute('role','status');el.setAttribute('aria-live','polite');}
}
async function importFile(file,target='comics'){
 if(!file){mcImportStatus('Selecciona un archivo CSV, XLSX o JSON.',true);return;}
 mcImportStatus('Leyendo '+file.name+'…');
 busy(true,'Leyendo '+file.name+'…');
 try{
  if(!/\.(json|csv|xlsx)$/i.test(file.name))throw Error('Formato no admitido: utiliza CSV, XLSX o JSON');
  let raw=[],backup=null;
  if(/\.json$/i.test(file.name)){const parsed=JSON.parse(await file.text());if(Array.isArray(parsed))raw=parsed;else if(parsed&&Array.isArray(parsed.comics)){raw=parsed.comics;backup=parsed}else if(parsed&&Array.isArray(parsed.master))raw=parsed.master;else throw Error('JSON sin lista de cómics reconocible')}
  else if(/\.xlsx$/i.test(file.name))raw=await parseXlsx(file);
  else raw=mcImportParseCsv(await file.text());
  if(!raw.length)throw Error('No se encontraron cómics en el archivo');
  if(raw.length>100000)throw Error('Importación demasiado grande: divide el archivo en bloques de 100.000');
  const rows=raw.map(mcImportMap).filter(x=>x.publisher&&(x.catalogHeader||x.series));
  const rejected=raw.length-rows.length;
  const existing=await allStore(target),existingKeys=new Set(existing.map(mcImportKey)),seen=new Set();
  const unique=[],duplicates=[],ambiguous=[];
  for(const x of rows){const key=mcImportKey(x);if(seen.has(key)||existingKeys.has(key))duplicates.push(x);else if(target==='comics'&&[...existing,...unique].some(y=>mcImportIdentityConflict(x,y))){ambiguous.push(x)}else{seen.add(key);unique.push(x)}}
  mcImportPending={file:file.name,target,unique,duplicates,ambiguous,rejected,backup};
  mcImportStatus('Archivo leído: '+raw.length+' filas; '+unique.length+' nuevas, '+duplicates.length+' duplicadas  , '+ambiguous.length+' ambiguas y '+rejected+' rechazadas. Confirma en la ventana de vista previa.');
  const modal=document.getElementById('modal');
  modal.innerHTML=`<div class="modalbox"><div class="modalhead"><div><b>Vista previa de importación</b><div class="muted small">${esc(file.name)}</div></div><button class="btn" onclick="closeModal()">Cerrar</button></div><div class="modalbody"><p><b>${raw.length.toLocaleString('es-ES')}</b> filas leídas · <b>${unique.length.toLocaleString('es-ES')}</b> nuevas · <b>${duplicates.length.toLocaleString('es-ES')}</b> duplicadas · <b>${ambiguous.length}</b> ambiguas sin edición completa · <b>${rejected}</b> sin editorial/cabecera.</p><p class="muted">Solo se añadirán registros nuevos. No se borrarán ni sobrescribirán fichas existentes. Los duplicados se omiten. Las coincidencias ambiguas con volumen/etapa/año incompletos quedan bloqueadas para revisión; no se asigna una edición automáticamente.</p><div style="max-height:260px;overflow:auto"><table><thead><tr><th>Editorial</th><th>Cabecera</th><th>Número</th><th>Estado</th></tr></thead><tbody>${unique.slice(0,30).map(x=>`<tr><td>${esc(x.publisher)}</td><td>${esc(x.catalogHeader)}</td><td>${esc(x.issueNr)}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody></table></div>${ambiguous.length?`<p class="muted"><b>${ambiguous.length} filas bloqueadas por posible coincidencia con otra edición:</b> ${ambiguous.slice(0,12).map(x=>esc((x.publisher||'')+' · '+(x.catalogHeader||x.series||'')+' #'+(x.issueNr||x.issue||''))).join('; ')}. Completa volumen, etapa y año en el archivo para diferenciarlas antes de reimportar.</p>`:''}<div class="actions" style="margin-top:18px"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="mcImportConfirm()">Importar ${unique.length.toLocaleString('es-ES')} nuevos</button></div></div></div>`;
  modal.classList.remove('hidden');
 }catch(e){console.error(e);mcImportStatus('Error de importación: '+(e.message||e),true);toast('Error de importación: '+(e.message||e))}finally{busy(false)}
}
async function mcImportConfirm(){
 const pending=mcImportPending;if(!pending)return;
 mcImportPending=null;
 if(!pending.unique.length){closeModal();toast('No hay registros nuevos');return}
 busy(true,'Importando fichas…');
 try{await bulkPut(pending.target,pending.unique.map(x=>({...x,id:uuid(pending.target==='master'?'m':'c')})));closeModal();toast('Importados '+pending.unique.length.toLocaleString('es-ES')+' cómics nuevos');await render();mcImportStatus('Importación completada: '+pending.unique.length+' registros guardados.')}
 catch(e){console.error(e);mcImportStatus('Error al guardar: '+(e.message||e),true);toast('Error al guardar: '+(e.message||e))}
 finally{busy(false)}
}
async function mcResetImportTest(){
 if(!MC_IMPORT_TEST){toast('Disponible solo en modo prueba');return}
 if(!confirm('¿Vaciar SOLO los cómics de esta sesión de prueba? No afecta a la COMICTECA personal ni al Maestro.'))return;
 await clearStore('comics');
 mcImportPending=null;
 toast('Colección de prueba vaciada');
 await render();
}
function mcImportTemplate(){
 // UTF-8 BOM (actual character, not the literal backslash-u sequence) for Excel.
 // Header-only template: sample rows belong in documentation, never in imports.
 const columns=['Editorial','Cabecera','Volumen','Etapa','Año de inicio','Número','Título','Subtítulo','Fecha publicación','Autores','Autores y roles','Sinopsis','Personajes','Género','Saga','Edición original','Equivalencias','Formato','Páginas','ISBN','EAN','Precio','Variantes','URL portada','Portadas alternativas','Fuentes','Fecha de actualización','Estado','Tags','Conservación','Ubicación','Fecha de compra','Precio pagado','Notas'];
 const quote=x=>'"'+String(x).replace(/"/g,'""')+'"';
 download('COMICTECA_plantilla_importacion.csv','\uFEFF'+columns.map(quote).join(';')+'\r\n','text/csv;charset=utf-8');
}
async function backupView(){
 const c=await allStore('comics'),m=await allStore('master'),p=await allStore('purchases');
 return head('Mi colección · Importar y exportar','Gestiona tus cómics en tres pasos sencillos.')+`
 <div class="mc-data-grid">
  <section class="card mc-data-card">
   <div class="mc-data-step">01 · AÑADIR CÓMICS</div>
   <h3>Importa tu colección</h3>
   <p class="muted">¿Ya tienes tus cómics en un Excel? Súbelo aquí. Revisaremos los datos antes de añadirlos.</p>
   <label class="btn primary mc-data-action">Importar archivo<input class="hidden" type="file" accept=".json,.csv,.xlsx" onchange="importFile(this.files[0],'comics');this.value='' "></label>
   <p class="muted small">Excel (.xlsx), CSV o JSON</p>
   <p id="mcImportStatus" role="status" aria-live="polite" class="small muted"> </p>
  </section>
  <section class="card mc-data-card">
   <div class="mc-data-step">02 · EMPEZAR DESDE CERO</div>
   <h3>Prepara tu archivo</h3>
   <p class="muted">Descarga una plantilla con los campos de COMICTECA, rellénala y después impórtala.</p>
   <button class="btn mc-data-action" onclick="mcImportTemplate()">Descargar plantilla Excel/CSV</button>
   <p class="muted small">También puedes añadir cómics uno a uno desde Catálogo.</p>
  </section>
  <section class="card mc-data-card">
   <div class="mc-data-step">03 · GUARDAR TUS DATOS</div>
   <h3>Haz una copia de seguridad</h3>
   <p class="muted">Descarga tus datos para conservarlos o llevarlos a otro dispositivo.</p>
   <button class="btn primary mc-data-action" onclick="exportBackup()">Descargar mi copia</button>
   <button class="btn mc-data-secondary" onclick="exportCSV()">Exportar listado CSV</button>
   <p class="muted small">${c.length.toLocaleString('es-ES')} cómics en tu colección</p>
  </section>
 </div>
 <details class="card mc-data-more"><summary>Más opciones</summary>
  <div class="mc-data-more-body">
   <div><h3>Importar fichas al Maestro</h3><p class="muted">Incorpora fichas de referencia desde un archivo.</p><label class="btn">Seleccionar archivo<input class="hidden" type="file" accept=".json,.csv,.xlsx" onchange="importFile(this.files[0],'master');this.value='' "></label></div>
   <div><h3>Administrar datos locales</h3><p class="muted">${m.length.toLocaleString('es-ES')} fichas de referencia · ${p.length} compras.</p>
    ${MC_IMPORT_TEST?`<button class="btn" onclick="mcResetImportTest()">Vaciar colección actual</button>`:`<button class="btn danger" onclick="resetAll()">Eliminar datos de este dispositivo</button>`}
   </div>
  </div>
 </details>`;
}

async function exportBackup(){const data={app:'MI COMICOTECA',version:3,exportedAt:new Date().toISOString(),comics:await allStore('comics'),purchases:await allStore('purchases'),master:await allStore('master')};download('MI_COMICOTECA_BACKUP_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(data),'application/json')}
async function exportCSV(){const rows=await allStore('comics'),cols=['publisher','catalogHeader','volume','stage','startYear','series','issueNr','format','status','tags','group','arc','subtitle','title','isbn','legalDeposit','publicationDate','pages','color','edition','coverUrl','purchaseDate','paid','estimated','condition','location','read','priority','seller','review','notes'],q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';download('MI_COMICOTECA_CATALOGO.csv','\ufeff'+cols.join(';')+'\n'+rows.map(r=>cols.map(c=>q(r[c])).join(';')).join('\n'),'text/csv;charset=utf-8')}
async function resetAll(){if(!confirm('¿Borrar colección, maestro y compras guardados en ESTE dispositivo? Exporta antes una copia si la necesitas.'))return;for(const s of ['comics','master','purchases'])await clearStore(s);toast('Datos locales borrados');await render()}
// Contacto público de MI COMICTECA. Solo enlaces de correo; no se almacenan mensajes en el navegador.
function contactoView(){
 const email='contacto@micomicteca.es',subject=encodeURIComponent('Consulta — MI COMICTECA');
 return head('Contacta con nosotros','¿Necesitas ayuda con tu colección o tu cuenta? Estamos aquí para escucharte.')+`
 <div class="mc-contact-layout">
  <section class="card mc-contact-card">
   <div class="mc-contact-eyebrow">ATENCIÓN AL COLECCIONISTA</div>
   <h2>Hablemos de tu colección</h2>
   <p>¿Tienes alguna duda sobre el catálogo, las colecciones, las portadas, las importaciones o tu membresía? ¿Has encontrado un error o quieres proponer una mejora?</p>
   <p>Escríbenos indicando brevemente qué necesitas. Para incidencias de la aplicación, puedes incluir el nombre de la sección y una captura de pantalla <strong>sin información sensible</strong>.</p>
   <div class="mc-contact-email"><span>Correo de contacto</span><strong>${esc(email)}</strong><small>El buzón está pendiente de activación en OVHcloud. Antes de enviar consultas, comprobaremos que puede recibir mensajes.</small></div>
   <div class="mc-contact-actions"><a class="btn primary" href="mailto:${email}?subject=${subject}" aria-label="Preparar correo para contactar con MI COMICTECA">✉ Escribir un correo</a><button class="btn" type="button" onclick="navigator.clipboard?.writeText('${email}').then(()=>toast('Dirección copiada')).catch(()=>toast('Selecciona y copia la dirección'))">Copiar dirección</button></div>
  </section>
  <section class="card mc-contact-card mc-contact-aside">
   <h3>¿En qué podemos ayudarte?</h3>
   <div class="mc-contact-item"><b>📚 Mi colección</b><p>Importación, fichas, portadas, maestro y wishlist.</p></div>
   <div class="mc-contact-item"><b>🔑 Mi cuenta</b><p>Acceso, contraseña y dudas sobre la membresía.</p></div>
   <div class="mc-contact-item"><b>💳 Pagos y bajas</b><p>Para detener una renovación, entra en <strong>Cuenta / Suscripción → Darse de baja</strong>. También puedes consultarnos cualquier incidencia.</p></div>
   <div class="mc-contact-item"><b>✨ Ideas y mejoras</b><p>Ayúdanos a decidir qué funciones incorporar próximamente.</p></div>
   <p class="mc-contact-privacy">Nunca envíes contraseñas, números completos de tarjeta ni claves de acceso.</p>
  </section>
 </div>`;
}
async function render(){let html='';if(current==='dashboard')html=await (window.PbiDashboard&&typeof window.PbiDashboard.view==='function'?window.PbiDashboard.view():dashboard());if(current==='catalog')html=await catalogView(false);if(current==='wishlist')html=await catalogView(true);if(current==='series')html=await seriesView();if(current==='master')html=await masterView();if(current==='purchases')html=await purchasesView();if(current==='quality')html=await quality();if(current==='stats')html=await stats();if(current==='backup')html=await backupView();if(current==='contacto')html=contactoView();$('#view').innerHTML=html;if(current==='catalog')await renderCat(false);if(current==='wishlist')await renderCat(true);if(current==='series')await renderSeries();if(current==='master'&&(await allStore('master')).length)await renderMaster()}
window.onclick=e=>{if(e.target.id==='modal')closeModal()};window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').classList.add('hidden')}};
function startupFailure(stage,e){console.error('[COMICTECA startup:'+stage+']',e);const view=document.querySelector('#view')||document.body;const msg=stage==='storage'?'No se ha podido acceder al almacenamiento local en este navegador. Tus datos no se han borrado. Cierra otras pestañas de COMICTECA y vuelve a intentarlo.':'La aplicación no ha podido completar el arranque. Tus datos locales no se han borrado.';view.innerHTML=`<div class="card" style="margin:24px;max-width:760px"><h2>No se pudo iniciar COMICTECA</h2><p>${msg}</p><p class="muted">Detalle técnico: ${String(e&&e.message||e||'Error desconocido').replace(/[<>&]/g,s=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</p><button class="btn primary" onclick="location.reload()">Reintentar</button></div>`}
(async()=>{try{await openDB()}catch(e){startupFailure('storage',e);return}if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(e=>console.warn('[COMICTECA service worker]',e));try{await render()}catch(e){startupFailure('render',e)}})();
