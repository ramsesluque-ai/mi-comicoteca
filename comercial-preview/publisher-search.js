'use strict';
/* Official publisher lookup. Metadata only; never embed/copy a restricted cover.
   The reader can open the verified product listing on the publisher's website. */
(function(){
const SOURCES=[
  {key:'panini',name:'Panini Comics',domain:'www.panini.es',site:'https://www.panini.es/'},
  {key:'norma',name:'Norma Editorial',domain:'www.normaeditorial.com',site:'https://www.normaeditorial.com/'},
  {key:'planeta',name:'Planeta Cómic',domain:'www.planetadelibros.com',site:'https://www.planetadelibros.com/'},
  {key:'astiberri',name:'Astiberri',domain:'www.astiberri.com',site:'https://www.astiberri.com/'},
  {key:'dolmen',name:'Dolmen Editorial',domain:'dolmeneditorial.com',site:'https://dolmeneditorial.com/'},
  {key:'milky way',name:'Milky Way Ediciones',domain:'www.milkywayediciones.com',site:'https://www.milkywayediciones.com/'}
];
function normalize(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
function source(p){const n=normalize(p);return SOURCES.find(x=>n.includes(x.key))||null}
function safePublisherLink(url,s){
  try{const u=new URL(url);const h=u.hostname.toLowerCase();return u.protocol==='https:'&&(h===s.domain||h.endsWith('.'+s.domain))?u.href:''}catch{return ''}
}
function anchor(u,label){return '<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>'}
function siteSearch(s,x){
  const term=String(x.isbn||'').trim()||[x.catalogHeader||x.series||'',x.issueNr||''].filter(Boolean).join(' ');
  return 'https://www.google.com/search?q='+encodeURIComponent('site:'+s.domain+' '+term)
}
function panel(title,body){if(typeof mcShowSearch==='function')mcShowSearch(title,body)}
function fallback(s,x,detail=''){
  panel('Consulta en editorial oficial','<div class="notice">'+esc(detail||'No se ha podido recuperar una ficha bibliográfica verificada en esta consulta.')+
  '</div><p>Consulta el catálogo original sin reproducir sus imágenes:</p><p>'+anchor(s.site,'Web de '+s.name)+' · '+anchor(siteSearch(s,x),'Buscar esta edición en '+s.name)+'</p>'+
  '<div class="muted small">No se descargan ni copian portadas de la editorial. Una coincidencia por nombre no certifica la edición.</div>')
}
let last=[];
async function lookup(){
  if(typeof mcFormComic!=='function')return;
  const x=mcFormComic(),s=source(x.publisher);
  if(!s){panel('Consulta en editorial oficial','<div class="notice">La editorial de esta ficha no tiene todavía integración oficial. Conservamos la consulta bibliográfica del Maestro y puedes verificar la información en su catálogo original.</div>');return}
  const isbn=String(x.isbn||'').replace(/[^0-9Xx]/g,'');
  if(!isbn&&!(x.catalogHeader||x.series)){fallback(s,x,'Para buscar en la editorial, introduce un ISBN o una cabecera.');return}
  panel('Consulta en '+s.name,'<div class="muted">Buscando metadatos en el catálogo oficial. Las imágenes no se descargan ni almacenan.</div>');
  if(!window.MCBridgeSearch?.search){fallback(s,x,'No está disponible el servicio de búsqueda editorial.');return}
  try{
    const results=await window.MCBridgeSearch.search({...x,sourceMode:'publisher'},(msg)=>{panel('Consulta en '+s.name,'<div class="muted">'+esc(msg)+'</div>')});
    last=results.filter(c=>c?.data?.sourceType==='publisher'&&safePublisherLink(c.data.sourceUrl,s)&&(!isbn||String(c.data.isbn||'').replace(/[^0-9Xx]/g,'')===isbn)).slice(0,6);
    if(!last.length){fallback(s,x,'No hay una coincidencia editorial suficientemente verificada o el catálogo no permite la consulta automatizada.');return}
    panel('Resultados de '+s.name,
      '<div class="ficha-result-grid">'+last.map((c,i)=>{
        const d=c.data,u=safePublisherLink(d.sourceUrl,s);
        return '<article class="ficha-result"><div><b>'+esc(d.title||'Publicación')+'</b>'+
          '<div class="small muted">'+esc([d.publisher,d.isbn&&'ISBN '+d.isbn,d.pages&&d.pages+' páginas'].filter(Boolean).join(' · '))+'</div>'+
          '<div class="notice" style="margin:8px 0"><b>Portada no reproducida.</b> Derechos de imagen no verificados. Puedes consultar la portada en la ficha de la editorial.</div>'+
          '<div class="small" style="overflow-wrap:anywhere">'+anchor(u,'Ver portada y ficha oficial')+
          '<div class="muted">'+esc(u)+'</div></div>'+
          '<button class="btn sm primary" type="button" onclick="mcApplyOfficialPublisherData('+i+')">Completar campos vacíos</button></div></article>'
      }).join('')+'</div><p class="muted small">Los datos se aplican únicamente al pulsar el botón y debes guardar la ficha. No se copia ninguna imagen.</p>'
    );
  }catch(err){fallback(s,x,(/credencial|token|gitHub/i.test(String(err?.message||err)))?'Para recuperar datos automáticamente debes configurar la conexión GitHub de COMICTECA. Puedes consultar la ficha oficial manualmente.':'Consulta no disponible en este momento: '+String(err?.message||err).slice(0,180))}
}
window.mcApplyOfficialPublisherData=async function(i){
 const c=last[i];if(!c)return;
 const d={...c.data};delete d.coverUrl;delete d.coverUrls;
 if(typeof mcSEApplyFields==='function')await mcSEApplyFields(d);
 else if(typeof mcSetBlank==='function'){
   for(const [k,v] of Object.entries({title:d.title,publisher:d.publisher,publicationDate:d.publicationDate,pages:d.pages,isbn:d.isbn}))mcSetBlank(k,v);
 }
 if(typeof toast==='function')toast('Datos bibliográficos aplicados. Guarda la ficha para conservarlos.');
};
window.mcSearchFichaPublishers=lookup;
function addButton(){
 const foot=document.querySelector('#modal .modalfoot');
 if(!foot||foot.querySelector('[data-official-publisher]'))return;
 const btn=document.createElement('button');
 btn.type='button';btn.className='btn';btn.dataset.officialPublisher='1';
 btn.textContent='⌕ Buscar en editoriales';
 btn.addEventListener('click',lookup);foot.appendChild(btn);
}
const previous=window.editComic;
if(typeof previous==='function')window.editComic=async function(...args){const v=await previous.apply(this,args);addButton();return v};
})();
