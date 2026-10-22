'use strict';
/* v18: preservar la base bibliográfica inicial del Maestro y neutralizar datos personales */
const MC_MASTER_PRESERVED='mc_master_preserved_v18';

mcRemoveSyntheticMaster=async function(){
  if(localStorage.getItem(MC_MASTER_PRESERVED))return;
  const rows=await allStore('master');
  if(!rows.length){localStorage.setItem(MC_MASTER_PRESERVED,'1');return}
  const neutral=rows.map(x=>({
    ...x,
    source:x.source||'Base bibliográfica inicial',
    status:'',tags:'',purchaseDate:'',paid:'',estimated:'',condition:'',location:'',read:'',priority:'',seller:'',review:'',notes:''
  }));
  await bulkPut('master',neutral);
  localStorage.setItem(MC_MASTER_PRESERVED,'1');
};

async function mcPersonalMatch(x){
  const rows=await allStore('comics');
  const key=[ckey(x),String(x.issueNr||x.issue||'')].join('|');
  return rows.find(c=>[ckey(c),String(c.issueNr||c.issue||'')].join('|')===key)||null;
}

openMasterCollection=async function(encoded){
  const k=decodeURIComponent(encoded),m=(await allStore('master')).filter(x=>ckey(x)===k).sort(mcSortRecord),sample=m[0];
  const personal=await allStore('comics'),pmap=new Map(personal.map(x=>[[ckey(x),String(x.issueNr||x.issue||'')].join('|'),x]));
  $('#modal').innerHTML=`<div class="modalbox"><div class="modalhead"><div><b>${esc(sample?clabel(sample):'Colección')}</b><div class="muted small">${m.length} números en el inventario bibliográfico</div></div><button class="btn" onclick="closeModal()">Cerrar</button></div><div class="modalbody"><div class="issue-grid master-issues">${m.map(x=>{const pk=[ckey(x),String(x.issueNr||x.issue||'')].join('|'),mine=pmap.get(pk);return `<article class="issue-card master-issue">${img(x,'cover issuecover')}<div class="issue-body"><div class="issue-no">#${esc(x.issueNr||x.issue||'—')}</div><div class="issue-title">${esc(x.title||x.subtitle||'Sin título')}</div><div class="muted small">${esc([x.publicationDate,x.isbn?('ISBN '+x.isbn):'',x.edition,x.format].filter(Boolean).join(' · '))}</div><div class="muted small">Fuente: ${esc(x.source||'Base bibliográfica inicial')}</div><div class="issue-actions">${mine?`${statusPill(mine.status)}${mine.status==='On Wish List'?` <button class="btn sm primary" onclick="mcPromoteMasterIssue('${esc(mine.id)}')">Pasar a mi colección</button>`:''}`:`<button class="btn sm primary" onclick="addFromMaster('${esc(x.id)}','In Collection')">Añadir a mi colección</button><button class="btn sm" onclick="addFromMaster('${esc(x.id)}','On Wish List')">Añadir a Wishlist</button>`}</div></div></article>`}).join('')}</div></div></div>`;
  $('#modal').classList.remove('hidden');
  CoverVault?.hydrate?.();
};

async function mcPromoteMasterIssue(id){
  const x=await getStore('comics',id);if(!x)return;
  await putStore('comics',{...x,status:'In Collection'});
  toast('Pasado a tu colección');
  await openMasterCollection(encodeURIComponent(ckey(x)));
}
