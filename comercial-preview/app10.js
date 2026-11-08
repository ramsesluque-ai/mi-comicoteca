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
      <label for="mc_top_code">ISBN / código</label>
      <div class="ficha-code-row">
        <input id="mc_top_code" value="${esc(current)}" placeholder="Introduce ISBN">
        <button class="btn" type="button" onclick="mcCompleteByTopCode()">Buscar ISBN</button>
      </div>
    </div>
    <button class="btn primary" type="button" onclick="mcSearchFichaAllFromTop()">Buscar portada y datos</button>
    `;
  const topCode=document.getElementById('mc_top_code');
  if(topCode){
    topCode.addEventListener('input',()=>{if(isbn)isbn.value=topCode.value});
    topCode.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();mcCompleteByTopCode();}});
  }
  if(isbn){isbn.addEventListener('input',()=>{const t=document.getElementById('mc_top_code');if(t&&t.value!==isbn.value)t.value=isbn.value});}
  // Move only the collection identification controls beside the large cover.
  // Keep the same inputs and IDs so existing save, ISBN and cover workflows are unchanged.
  const grid=modal.querySelector('.modalbody > .formgrid');
  const identification=[...grid?.children||[]].find(el=>el.classList.contains('sectiontitle')&&el.textContent.trim()==='Identificación de colección');
  if(identification&&top&&!top.querySelector('.mc-identity-panel')){
    const panel=document.createElement('section');
    panel.className='mc-identity-panel';
    const heading=document.createElement('h3');
    heading.textContent='Identificación de colección';
    panel.appendChild(heading);
    let node=identification.nextElementSibling;
    const fields=[];
    while(node&&!node.classList.contains('sectiontitle')){
      fields.push(node);
      node=node.nextElementSibling;
    }
    for(const field of fields)panel.appendChild(field);
    identification.remove();
    top.appendChild(panel);
  }
  CoverVault?.hydrate?.();
};
function mcSyncTopCode(){const t=document.getElementById('mc_top_code'),isbn=document.getElementById('m_isbn');if(t&&isbn)isbn.value=t.value.trim();return t?.value.trim()||isbn?.value.trim()||''}
async function mcSearchFichaAllFromTop(){mcSyncTopCode();await mcSearchFichaAll()}
async function mcCompleteByTopCode(){const c=mcSyncTopCode();if(!c)return toast('Introduce un ISBN, EAN, UPC u otro código');await mcCompleteByCode()}
