'use strict';
/* Public interactive preview: synthetic in-memory data only. No Supabase, IndexedDB or storage writes. */
(function(){
 const comics=[
  {id:1,serie:'Centinela Nocturno',editorial:'Editorial Ejemplo',numero:1,estado:'Colección',cover:'🌙'},
  {id:2,serie:'Centinela Nocturno',editorial:'Editorial Ejemplo',numero:2,estado:'Colección',cover:'🌙'},
  {id:3,serie:'Centinela Nocturno',editorial:'Editorial Ejemplo',numero:3,estado:'Pendiente',cover:'🌙'},
  {id:4,serie:'Exploradores del Cosmos',editorial:'Editorial Ejemplo',numero:1,estado:'Colección',cover:'🚀'},
  {id:5,serie:'Exploradores del Cosmos',editorial:'Editorial Ejemplo',numero:2,estado:'Wishlist',cover:'🚀'},
  {id:6,serie:'La Ciudad Sumergida',editorial:'Editorial Ejemplo',numero:1,estado:'Colección',cover:'🌊'}
 ];
 let draft=null,tab='dashboard',search='';
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const state=()=>draft||comics;
 const pill=x=>'<span class="mc-demo-pill">'+esc(x)+'</span>';
 function open(){
  draft=comics.map(x=>({...x}));tab='dashboard';search='';
  let root=document.getElementById('mcDemoRoot');
  if(!root){root=document.createElement('div');root.id='mcDemoRoot';document.body.appendChild(root)}
  root.style.display='block';render();
 }
 function close(){const root=document.getElementById('mcDemoRoot');if(root){root.remove()}draft=null}
 function render(){
  const root=document.getElementById('mcDemoRoot');if(!root)return;
  const data=state(),owned=data.filter(x=>x.estado==='Colección'),wish=data.filter(x=>x.estado==='Wishlist');
  root.innerHTML='<div class="mc-demo-shell" role="dialog" aria-modal="true" aria-label="Demostración MI COMICTECA"><header class="mc-demo-head"><div><strong>MI COMICTECA · DEMO</strong><small>Datos inventados · Ningún cambio se guarda</small></div><button id="mcDemoExit" class="btn">Salir de la demo ✕</button></header><nav class="mc-demo-tabs">'+[['dashboard','Dashboard'],['catalog','Catálogo'],['series','Colecciones'],['wishlist','Wishlist'],['master','Maestro']].map(([k,v])=>'<button data-demo-tab="'+k+'" class="'+(tab===k?'active':'')+'">'+v+'</button>').join('')+'</nav><main class="mc-demo-body" id="mcDemoBody"></main><footer class="mc-demo-footer"><span>Explora sin riesgos. Tu catálogo personal permanece bloqueado hasta activar la membresía.</span><button class="btn primary" id="mcDemoStart">Crear cuenta / Suscribirme</button></footer></div>';
  document.getElementById('mcDemoExit').onclick=close;
  document.getElementById('mcDemoStart').onclick=()=>{close();window.CommercialBilling?.show?.()};
  root.querySelectorAll('[data-demo-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.demoTab;render()});
  const body=document.getElementById('mcDemoBody');
  if(tab==='dashboard'){
   body.innerHTML='<h2>Así verás tu colección</h2><div class="mc-demo-kpis"><div><b>'+owned.length+'</b><span>Ejemplares</span></div><div><b>'+new Set(owned.map(x=>x.serie)).size+'</b><span>Colecciones</span></div><div><b>'+wish.length+'</b><span>En Wishlist</span></div><div><b>'+data.filter(x=>x.estado==='Pendiente').length+'</b><span>Pendientes</span></div></div><p>Prueba a cambiar el estado de los ejemplares en Catálogo o Maestro y observa cómo se actualizan estos indicadores.</p>';
  }else if(tab==='series'){
   const names=[...new Set(data.map(x=>x.serie))];
   body.innerHTML='<h2>Mis colecciones</h2><div class="mc-demo-grid">'+names.map(n=>{const items=data.filter(x=>x.serie===n);return '<article class="mc-demo-card"><div class="mc-demo-cover">'+items[0].cover+'</div><b>'+esc(n)+'</b><p>'+items.filter(x=>x.estado==='Colección').length+' de '+items.length+' números en colección</p><div class="mc-demo-meter"><span style="width:'+Math.round(100*items.filter(x=>x.estado==='Colección').length/items.length)+'%"></span></div></article>'}).join('')+'</div>';
  }else{
   const filtered=data.filter(x=>(tab==='wishlist'?x.estado==='Wishlist':tab==='catalog'?x.estado==='Colección':true)&&[x.serie,x.editorial,String(x.numero)].join(' ').toLowerCase().includes(search.toLowerCase()));
   body.innerHTML='<h2>'+({catalog:'Mi catálogo',wishlist:'Mi Wishlist',master:'Maestro de ejemplo'})[tab]+'</h2><p>Haz clic en los botones para simular el traspaso entre Maestro, colección y Wishlist. Los cambios se perderán al cerrar la demo.</p><input id="mcDemoSearch" placeholder="Buscar serie o editorial…" value="'+esc(search)+'" aria-label="Buscar cómics"><div class="mc-demo-grid">'+filtered.map(x=>'<article class="mc-demo-card"><div class="mc-demo-cover">'+x.cover+'</div><b>'+esc(x.serie)+' · Nº '+x.numero+'</b><small>'+esc(x.editorial)+'</small>'+pill(x.estado)+'<div class="mc-demo-actions"><button data-demo-id="'+x.id+'" data-demo-state="Colección" '+(x.estado==='Colección'?'disabled':'')+'>A colección</button><button data-demo-id="'+x.id+'" data-demo-state="Wishlist" '+(x.estado==='Wishlist'?'disabled':'')+'>Wishlist</button></div></article>').join('')+'</div>';
   body.querySelector('#mcDemoSearch').oninput=e=>{const cursor=e.target.selectionStart;search=e.target.value;render();const input=document.getElementById('mcDemoSearch');input?.focus();input?.setSelectionRange(cursor,cursor)};
   body.querySelectorAll('[data-demo-id]').forEach(b=>b.onclick=()=>{const item=draft.find(x=>x.id===Number(b.dataset.demoId));if(item)item.estado=b.dataset.demoState;render()});
  }
 }
 function addButtons(){
  document.querySelectorAll('#mcAccessGate').forEach(gate=>{
   if(gate.querySelector('[data-mc-demo]'))return;
   const target=gate.querySelector('.mc-hero-actions')||gate.querySelector('.mc-gate-simple');
   if(!target)return;
   const b=document.createElement('button');b.className='btn mc-demo-launch';b.type='button';b.dataset.mcDemo='1';b.textContent='Probar demo gratuita';b.onclick=open;target.appendChild(b);
  });
 }
 const obs=new MutationObserver(addButtons);
 function init(){obs.observe(document.body,{childList:true,subtree:true});addButtons()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
 window.MiComictecaDemo={open,close};
})();