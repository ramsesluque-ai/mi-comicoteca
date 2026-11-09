'use strict';
/* Ficha: plantilla de número nuevo y navegación por la misma edición. */
(function(){
 const base=window.editComic;
 if(typeof base!=='function')return;
 let sequence=[],current='',baseline='';
 const snapshot=()=>{const modal=document.querySelector('#modal');if(!modal)return '';return JSON.stringify(Array.from(modal.querySelectorAll('input,select,textarea')).filter(el=>!['button','submit','reset','file','hidden'].includes(el.type)).map(el=>[el.id||el.name,el.type==='checkbox'||el.type==='radio'?el.checked:el.value]));};
 const hasChanges=()=>snapshot()!==baseline;
 window.mcComicMarkSaved=()=>{baseline=snapshot()};
 const issueValue=x=>String(x.issueNr??x.issue??'').trim();
 const compare=(a,b)=>issueValue(a).localeCompare(issueValue(b),'es',{numeric:true,sensitivity:'base'});
 const setField=(name,value)=>{const el=document.getElementById('m_'+name);if(el)el.value=value==null?'':String(value)};
 const common=['publisher','catalogHeader','volume','stage','startYear','series','group','color','edition','format','arc','pages'];
 async function decorate(id){
  const foot=document.querySelector('#modal .modalfoot');
  if(!foot)return;
  const record=id?await getStore('comics',id):null;
  if(!record)return;
  const same=(await allStore('comics')).filter(x=>ckey(x)===ckey(record)&&x.status===record.status).sort(compare);
  sequence=same.map(x=>x.id);current=id;
  const i=sequence.indexOf(id);
  const bar=document.createElement('div');
  bar.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-right:auto';
  const make=(label,action,disabled)=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.disabled=disabled;b.onclick=action;bar.appendChild(b)};
  make('← Anterior',()=>move(-1),i<=0);
  make('Siguiente →',()=>move(1),i<0||i>=sequence.length-1);
  make('Copiar cómic',()=>copy(id),false);
  foot.prepend(bar);
  baseline=snapshot();
 }
 async function move(direction){
  const index=sequence.indexOf(current),target=sequence[index+direction];
  if(!target)return;
  if(hasChanges()&&!confirm('Hay cambios sin guardar. ¿Quieres descartarlos y abrir otra ficha?'))return;
  await window.editComic(target);
 }
 async function copy(id){
  const source=await getStore('comics',id);
  if(!source)return;
  
  if(hasChanges()&&!confirm('Hay cambios sin guardar. ¿Quieres descartarlos y crear una copia?'))return;
  await window.editComic();
  for(const field of common)setField(field,source[field]||'');
  setField('status',source.status||'In Collection');
  setField('issueNr','');
  const heading=document.querySelector('.mc-comic-kicker');
  if(heading)heading.textContent='Nuevo cómic · plantilla de '+(source.catalogHeader||source.series||'serie');
  const info=document.createElement('p');
  info.className='muted small';
  info.textContent='Plantilla preparada. Introduce el número y los datos particulares, comprueba la ficha y pulsa Guardar. No se ha duplicado la portada ni la compra.';
  document.querySelector('#modal .modalbody')?.prepend(info);
  document.getElementById('m_issueNr')?.focus();
 }
 window.comicCopyFrom=copy;
 window.editComic=async function(id){await base(id);await decorate(id)};
})();