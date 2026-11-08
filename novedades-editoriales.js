'use strict';
/* Calendario editorial comercial. Solo metadatos bibliográficos breves
   comprobados en fuentes oficiales. Sin portadas, scraping ni importación masiva. */
(function(){
  const SOURCES=[
    {name:'Astiberri',url:'https://www.astiberri.com/posts/novedades-astiberri-noviembre26',description:'Novedades noviembre 2026'},
    {name:'Planeta Cómic',url:'https://www.planetadelibros.com/editorial/planeta-comic/54',description:'Novedades de Planeta Cómic'},
    {name:'Norma Editorial',url:'https://www.normaeditorial.com/normaland',description:'Novedades y revista editorial'},
    {name:'Panini Comics',url:'https://www.panini.es/',description:'Catálogo editorial'},
    {name:'Dolmen Editorial',url:'https://dolmeneditorial.com/',description:'Catálogo editorial'}
  ];
  // Solo fechas conocidas y títulos publicados en fuentes oficiales. La ausencia
  // de fecha exacta se conserva: no se inventan días ni números de ejemplar.
  let RELEASES=[],loaded=false;
  async function loadReleases(){
    if(loaded)return RELEASES;
    const r=await fetch('./master-data/editorial-monthly.json',{cache:'no-cache'});
    if(!r.ok)throw Error('Novedades mensuales no disponibles');
    const data=await r.json();
    if(!data||!Array.isArray(data.releases))throw Error('Formato editorial no válido');
    RELEASES=data.releases.filter(x=>x&&x.id&&x.publisher&&x.month&&x.title&&x.sourceUrl&&!x.coverUrl);
    loaded=true;
    return RELEASES;
  }
  const state={month:'',publisher:'',q:''};
  const key=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  const monthWindow=()=>{
    const today=new Date(),base=new Date(today.getFullYear(),today.getMonth(),1);
    return [key(new Date(base.getFullYear(),base.getMonth()-1,1)),key(base)];
  };
  const monthLabel=k=>{const [y,m]=k.split('-').map(Number);return new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(new Date(y,m-1,1))};

  function safeUrl(u){try{const x=new URL(u);return x.protocol==='https:'?x.href:''}catch{return ''}}
  function dateLabel(x){if(!x.date)return 'Fecha exacta no publicada en la selección';const v=x.date.split('-');return v[2]+'/'+v[1]+'/'+v[0]}
  function matching(){
    return RELEASES.filter(x=>monthWindow().includes(x.month)&&(!state.month||x.month===state.month)&&(!state.publisher||state.publisher===x.publisher)&&
      (!state.q||norm([x.publisher,x.title,x.series,x.issueNr||''].join(' ')).includes(norm(state.q))));
  }
  async function view(){
    try{await loadReleases()}catch(e){console.warn('Novedades:',e);return head('Novedades','El calendario editorial no está disponible en este momento. La colección personal no se ha modificado.')}
    const items=matching();
    const grouped=SOURCES.filter(s=>!state.publisher||state.publisher===s.name).map(s=>({
      source:s,items:items.filter(x=>x.publisher===s.name)
    }));
    const renderIssue=x=>'<article class="card"><div class="muted small">'+esc(dateLabel(x))+'</div>'+
      '<h3>'+esc(x.title)+'</h3><div class="muted">'+esc(x.series)+(x.issueNr?' · Nº '+esc(x.issueNr):'')+'</div>'+
      '<p><a href="'+esc(safeUrl(x.sourceUrl))+'" target="_blank" rel="noopener noreferrer">Ver ficha / boletín oficial</a></p>'+
      '<div class="actions"><button class="btn sm primary" data-release-id="'+esc(x.id)+'" data-release-status="In Collection">+ Colección</button> '+
      '<button class="btn sm" data-release-id="'+esc(x.id)+'" data-release-status="On Wish List">+ Wishlist</button></div></article>';
    const count=items.length,months=monthWindow();
    return head('Novedades','Últimos dos meses: '+monthLabel(months[0])+' y '+monthLabel(months[1])+'. Agrupadas por editorial.')+
      '<div class="panel"><div class="filters">'+
        '<label>Mes <select id="new-month"><option value="" '+(!state.month?'selected':'')+'>Dos meses recientes</option>'+
         monthWindow().slice().reverse().map(m=>'<option value="'+esc(m)+'" '+(m===state.month?'selected':'')+'>'+esc(monthLabel(m))+'</option>').join('')+'</select></label>'+
        '<label>Editorial <select id="new-publisher"><option value="">Todas las editoriales</option>'+
          SOURCES.map(s=>'<option value="'+esc(s.name)+'" '+(state.publisher===s.name?'selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label>'+
        '<label>Buscar <input id="new-q" type="search" value="'+esc(state.q)+'" placeholder="Título o serie"></label></div>'+
      '<p class="small muted">'+count+' publicaciones seleccionadas y contrastadas para este filtro. No es todavía un listado exhaustivo ni una sincronización automática.</p>'+
      '<p class="small muted">Se muestran metadatos breves y enlaces a fuentes oficiales, sin copiar portadas ni sinopsis de terceros.</p></div>'+
      grouped.map(g=>'<section class="panel" style="margin:16px 0" aria-label="Novedades '+esc(g.source.name)+'">'+
        '<div class="top"><div><h2>'+esc(g.source.name)+' <span class="muted small">('+g.items.length+')</span></h2>'+
        '<p class="muted small">'+esc(g.source.description)+'</p></div>'+
        '<div class="actions"><a href="'+esc(safeUrl(g.source.url))+'" target="_blank" rel="noopener noreferrer">Web editorial</a></div></div>'+
        (g.items.length?'<div class="grid">'+g.items.map(renderIssue).join('')+'</div>':
          '<p class="muted">No se han verificado aún publicaciones de esta editorial para el mes y filtros elegidos. Consulta su calendario oficial.</p>')+
        '</section>').join('');
  }
  function afterRender(){
    const m=document.getElementById('new-month'),p=document.getElementById('new-publisher'),q=document.getElementById('new-q');
    if(m)m.onchange=()=>{state.month=m.value;render()};
    if(p)p.onchange=()=>{state.publisher=p.value;render()};
    if(q)q.onchange=()=>{state.q=q.value;render()};
    document.querySelectorAll('[data-release-id][data-release-status]').forEach(b=>b.onclick=()=>add(b.dataset.releaseId,b.dataset.releaseStatus));
  }
  async function add(id,status){
    await loadReleases();
    const x=RELEASES.find(x=>x.id===id);if(!x||!['In Collection','On Wish List'].includes(status))return;
    const rows=await allStore('comics');
    const repeated=rows.some(r=>r.sourceReleaseId===x.id||
      (norm(r.publisher)===norm(x.publisher)&&norm(r.catalogHeader||r.series)===norm(x.series)&&
       String(r.issueNr||r.issue||'')===String(x.issueNr||'')&&norm(r.title||'')===norm(x.title)));
    if(repeated){toast('Ya tienes esta publicación: no se ha duplicado.');return}
    const comic=cleanComic({id:uuid('c'),publisher:x.publisher,catalogHeader:x.series,series:x.series,
      title:x.title,issueNr:x.issueNr||'',issue:x.issueNr||'',publicationDate:x.date||'',startYear:'',
      status,source:'Editorial oficial',sourceUrl:x.sourceUrl,sourceReleaseId:x.id,coverUrl:'',
      purchaseDate:'',paid:'',condition:'',location:'',read:'',notes:''});
    await putStore('comics',comic);
    toast(status==='In Collection'?'Añadido a tu colección':'Añadido a tu Wishlist');
  }
  window.MCNewReleases={view,afterRender,add,monthWindow,monthLabel};
})();
