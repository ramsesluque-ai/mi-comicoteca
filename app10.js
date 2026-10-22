'use strict';
/* v15: caja de código arriba en ficha + sincronización con ISBN bibliográfico */
const mcEditComicV14=editComic;
editComic=async function(id){
  await mcEditComicV14(id);
  const modal=$('#modal'),top=modal?.querySelector('.formgrid > .span4.toolbar'),actions=top?.querySelector('.ficha-top-actions');
  if(!top||!actions)return;
  const isbn=document.getElementById('m_isbn');
  const current=isbn?.value||'';
  actions.innerHTML=`
    <div class="ficha-code-box">
      <label for="mc_top_code">ISBN / EAN / UPC / otro código</label>
      <div class="ficha-code-row">
        <input id="mc_top_code" value="${esc(current)}" placeholder="Escanea o pega el código">
        <button class="btn" type="button" onclick="mcCompleteByTopCode()">▣ Buscar por código</button>
      </div>
    </div>
    <button class="btn primary" type="button" onclick="mcSearchFichaAllFromTop()">⌕ Buscar datos y portada</button>
    <div class="small muted">La búsqueda usa primero el código si está informado y, además, Editorial + Serie/Cabecera + Nº + Año + Título.</div>`;
  const topCode=document.getElementById('mc_top_code');
  if(topCode){
    topCode.addEventListener('input',()=>{if(isbn)isbn.value=topCode.value});
    topCode.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();mcCompleteByTopCode();}});
  }
  if(isbn){isbn.addEventListener('input',()=>{const t=document.getElementById('mc_top_code');if(t&&t.value!==isbn.value)t.value=isbn.value});}
  CoverVault?.hydrate?.();
};
function mcSyncTopCode(){const t=document.getElementById('mc_top_code'),isbn=document.getElementById('m_isbn');if(t&&isbn)isbn.value=t.value.trim();return t?.value.trim()||isbn?.value.trim()||''}
async function mcSearchFichaAllFromTop(){mcSyncTopCode();await mcSearchFichaAll()}
async function mcCompleteByTopCode(){const c=mcSyncTopCode();if(!c)return toast('Introduce un ISBN, EAN, UPC u otro código');await mcCompleteByCode()}
