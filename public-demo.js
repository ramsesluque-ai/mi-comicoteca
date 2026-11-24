'use strict';
/* Public interactive preview: synthetic in-memory data only. No Supabase, IndexedDB or storage writes. */
(function(){
 let comics=[];
 const sources=['novaro-001','zinco-001','planeta-deagostini-001'];
 async function loadSample(){
  const results=await Promise.allSettled(sources.map(async name=>{
   const r=await fetch('master-data/publishers/'+name+'.json',{cache:'no-store',credentials:'omit'});
   if(!r.ok)throw Error('Catálogo no disponible');
   const rows=await r.json();if(!Array.isArray(rows))throw Error('Formato de catálogo');
   const groups=new Map();
   for(const x of rows){
    const serie=String(x.catalogHeader||x.series||'').trim(),numero=String(x.issueNr||x.issue||'').trim();
    if(!serie||!/^\\d+$/.test(numero))continue;
    const key=[serie,x.volume,x.startYear,x.stage].join('|');
    if(!groups.has(key))groups.set(key,new Map());
    const g=groups.get(key);if(!g.has(numero))g.set(numero,x);
   }
   return [...groups.values()].filter(g=>g.size>=5).sort((a,b)=>b.size-a.size).slice(0,4).flatMap(g=>[...g.values()].sort((a,b)=>Number(a.issueNr||a.issue)-Number(b.issueNr||b.issue)).slice(0,24));
  }));
  return results.flatMap(r=>r.status==='fulfilled'?r.value:[]).map((x,i)=>({id:i+1,serie:String(x.catalogHeader||x.series),editorial:String(x.publisher||''),numero:String(x.issueNr||x.issue),titulo:String(x.title||''),edicion:[x.volume,x.startYear,x.stage].filter(Boolean).join(' · '),estado:i%7===0?'Wishlist':i%5===0?'Pendiente':'Colección',coverUrl:x.coverRights?.approved===true&&/^https:\/\//i.test(x.coverUrl||'')?x.coverUrl:''}));
 }
 const cover=x=>'<div class="mc-demo-cover" style="height:190px;overflow:hidden;font-size:16px">'+(x.coverUrl?'<img loading="lazy" referrerpolicy="no-referrer" style="height:100%;max-width:100%;object-fit:contain" src="'+esc(x.coverUrl)+'" alt="'+esc(x.serie)+'">':'<div style="text-align:center;padding:16px"><small>'+esc(x.editorial)+'</small><strong style="display:block;font-size:22px;margin:12px 0">'+esc(x.serie)+'</strong><span>Nº '+esc(x.numero)+'</span></div>')+'</div>';
 let draft=null,tab='dashboard',search='';
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const state=()=>draft||comics;
 const pill=x=>'<span class="mc-demo-pill">'+esc(x)+'</span>';
 async function open(){
  draft=[];tab='dashboard';search='';
  let root=document.getElementById('mcDemoRoot');
  if(!root){root=document.createElement('div');root.id='mcDemoRoot';document.body.appendChild(root)}
  root.style.display='block';root.innerHTML='<div class="mc-demo-shell"><p style="padding:24px">Preparando biblioteca de demostración…</p><button class="btn" id="mcDemoLoadingExit">Salir</button></div>';document.getElementById('mcDemoLoadingExit').onclick=close;const sample=await loadSample();if(document.getElementById('mcDemoRoot')!==root)return;comics=sample;draft=comics.map(x=>({...x}));render();
 }
 function close(){const root=document.getElementById('mcDemoRoot');if(root){root.remove()}draft=null}
 function render(){
  const root=document.getElementById('mcDemoRoot');if(!root)return;
  const data=state(),owned=data.filter(x=>x.estado==='Colección'),wish=data.filter(x=>x.estado==='Wishlist');
  root.innerHTML='<div class="mc-demo-shell" role="dialog" aria-modal="true" aria-label="Demostración MI COMICTECA"><header class="mc-demo-head"><div><strong>MI COMICTECA · DEMO</strong><small>Datos bibliográficos de muestra · Cambios solo en esta sesión</small></div><button id="mcDemoExit" class="btn">Salir de la demo ✕</button></header><nav class="mc-demo-tabs">'+[['dashboard','Dashboard'],['catalog','Catálogo'],['series','Colecciones'],['wishlist','Wishlist'],['master','Maestro']].map(([k,v])=>'<button data-demo-tab="'+k+'" class="'+(tab===k?'active':'')+'">'+v+'</button>').join('')+'</nav><main class="mc-demo-body" id="mcDemoBody"></main><footer class="mc-demo-footer"><span>Explora sin riesgos. Tu catálogo personal permanece bloqueado hasta activar la membresía.</span><button class="btn primary" id="mcDemoStart">Crear cuenta / Suscribirme</button></footer></div>';
  document.getElementById('mcDemoExit').onclick=close;
  document.getElementById('mcDemoStart').onclick=()=>{close();window.CommercialBilling?.show?.()};
  root.querySelectorAll('[data-demo-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.demoTab;render()});
  const body=document.getElementById('mcDemoBody');
  if(!data.length){body.innerHTML='<h2>No se pudo cargar la muestra</h2><p>Vuelve a abrir la demo para reintentar.</p>';return;}
  if(tab==='dashboard'){
   body.innerHTML='<h2>Así verás tu colección</h2><div class="mc-demo-kpis"><div><b>'+owned.length+'</b><span>Ejemplares</span></div><div><b>'+new Set(owned.map(x=>[x.editorial,x.serie,x.edicion].join('|'))).size+'</b><span>Colecciones</span></div><div><b>'+wish.length+'</b><span>En Wishlist</span></div><div><b>'+data.filter(x=>x.estado==='Pendiente').length+'</b><span>Pendientes</span></div></div><p>Prueba a cambiar el estado de los ejemplares en Catálogo o Maestro y observa cómo se actualizan estos indicadores.</p><h2>Distribución por editorial</h2>'+[...new Set(data.map(x=>x.editorial))].map(n=>{const count=owned.filter(x=>x.editorial===n).length;return '<p>'+esc(n)+' · '+count+'</p><div class="mc-demo-meter"><span style="width:'+Math.round(100*count/Math.max(1,owned.length))+'%"></span></div>'}).join('');
  }else if(tab==='series'){
   const names=[...new Set(data.map(x=>[x.editorial,x.serie,x.edicion].join('|')))];
   body.innerHTML='<h2>Mis colecciones</h2><div class="mc-demo-grid">'+names.map(n=>{const items=data.filter(x=>[x.editorial,x.serie,x.edicion].join('|')===n);return '<article class="mc-demo-card">'+cover(items[0])+'<b>'+esc(items[0].serie)+' · '+esc(items[0].edicion)+'</b><p>'+items.filter(x=>x.estado==='Colección').length+' de '+items.length+' números en colección</p><div class="mc-demo-meter"><span style="width:'+Math.round(100*items.filter(x=>x.estado==='Colección').length/items.length)+'%"></span></div></article>'}).join('')+'</div>';
  }else{
   const filtered=data.filter(x=>(tab==='wishlist'?x.estado==='Wishlist':tab==='catalog'?x.estado==='Colección':true)&&[x.serie,x.editorial,String(x.numero)].join(' ').toLowerCase().includes(search.toLowerCase()));
   body.innerHTML='<h2>'+({catalog:'Mi catálogo',wishlist:'Mi Wishlist',master:'Maestro de ejemplo'})[tab]+'</h2><p>Haz clic en los botones para simular el traspaso entre Maestro, colección y Wishlist. Los cambios se perderán al cerrar la demo.</p><input id="mcDemoSearch" placeholder="Buscar serie o editorial…" value="'+esc(search)+'" aria-label="Buscar cómics"><div class="mc-demo-grid">'+filtered.map(x=>'<article class="mc-demo-card">'+cover(x)+'<b>'+esc(x.serie)+' · Nº '+esc(x.numero)+'</b><small>'+esc(x.titulo)+'</small><small>'+esc(x.editorial)+'</small>'+pill(x.estado)+'<div class="mc-demo-actions"><button data-demo-id="'+x.id+'" data-demo-state="Colección" '+(x.estado==='Colección'?'disabled':'')+'>A colección</button><button data-demo-id="'+x.id+'" data-demo-state="Wishlist" '+(x.estado==='Wishlist'?'disabled':'')+'>Wishlist</button></div></article>').join('')+'</div>';
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