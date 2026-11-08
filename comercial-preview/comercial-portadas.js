'use strict';
/* Portadas, edición comercial: consultas individuales y previsualización remota
 * autorizada por proveedor, sin descargar/republicar imágenes de terceros.
 * Los archivos aportados por el usuario permanecen locales hasta disponer
 * de almacenamiento privado verificado; no subir al repositorio público.
 */
(function(){
  const https=v=>{
    try{const u=new URL(String(v||''));return u.protocol==='https:'?u.href:''}catch{return ''}
  };
  const isbn=v=>String(v||'').replace(/[^0-9Xx]/g,'').toUpperCase();
  function sourceLabel(x){return String(x?.source||'Fuente de la ficha')}
  async function open(id){
    const comic=await getStore('comics',decodeURIComponent(String(id)));
    if(!comic){toast('No se ha encontrado la ficha');return}
    const n=isbn(comic.isbn),canPreview=n.length===10||n.length===13;
    const src=canPreview?'https://covers.openlibrary.org/b/isbn/'+encodeURIComponent(n)+'-M.jpg?default=false':'';
    const ol=canPreview?'https://openlibrary.org/isbn/'+encodeURIComponent(n):'';
    const origin=https(comic.sourceUrl||comic.source_url||'');
    const modal=document.getElementById('modal');
    if(!modal)return;
    modal.innerHTML='<div class="modalbox"><div class="modalhead"><div><b>Consultar portada · '+esc(comic.catalogHeader||comic.series||comic.title||'Ficha')+'</b>'+
      '<div class="muted small">'+esc([comic.publisher,comic.issueNr?'Nº '+comic.issueNr:'',n?'ISBN '+n:''].filter(Boolean).join(' · '))+'</div></div>'+
      '<button class="btn" onclick="closeModal()">Cerrar</button></div>'+
      '<div class="modalbody"><p>Consulta individual. La imagen no se descarga, modifica ni guarda en los servidores de MI COMICOTECA.</p>'+
      (canPreview?'<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:start">'+
        '<img loading="lazy" decoding="async" alt="Previsualización remota, si está disponible en Open Library" src="'+esc(src)+'" '+
        'style="width:160px;max-width:100%;min-height:190px;object-fit:contain" referrerpolicy="no-referrer">'+
        '<div><p><b>Open Library</b></p><p class="small muted">Vista remota desde la API oficial. Puede no existir una portada para este ISBN.</p>'+
        '<p><a target="_blank" rel="noopener noreferrer" href="'+esc(ol)+'">Consultar ficha y portada en Open Library</a></p></div></div>':
        '<div class="notice">No hay ISBN válido. Consulta la ficha original de la editorial o sube una imagen que puedas utilizar legítimamente.</div>')+
      (origin?'<p><a href="'+esc(origin)+'" target="_blank" rel="noopener noreferrer">Ver fuente bibliográfica de la ficha</a> · '+esc(sourceLabel(comic))+'</p>':'')+
      '<div class="notice">Las portadas de terceros no se guardan automáticamente. Para conservar una foto en tu catálogo utiliza «Subir imagen» desde Portadas, respetando los derechos aplicables.</div>'+
      '</div></div>';
    modal.classList.remove('hidden');
  }
  window.MCCommercialCovers={open,mode:'individual-preview-no-third-party-copy'};
  // Protege rutas heredadas que podían saltarse las restricciones del Maestro.
  window.mcFindCover=open;
  window.mcChooseCover=async()=>toast('La descarga de imágenes ajenas está desactivada en la edición comercial.');
  window.mcInternalizeOne=async()=>toast('No se copian automáticamente imágenes externas. Puedes subir una imagen autorizada.');
  window.mcInternalizeVisible=async()=>toast('La descarga de portadas por lotes está desactivada en la edición comercial.');
  if(window.CoverVault){
    window.CoverVault.attach=async()=>{throw Error('No se permite copiar portadas externas sin permiso verificado en la edición comercial')};
    window.CoverVault.syncPending=async()=>{throw Error('La sincronización de imágenes de usuario a GitHub público está desactivada en la edición comercial. Utiliza almacenamiento privado con permisos verificados.')};
  }
})();