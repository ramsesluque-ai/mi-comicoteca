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
  const RELEASES=[
    {id:'ast-2026-11-lengua',publisher:'Astiberri',month:'2026-11',date:'2026-11-05',title:'Lengua materna',series:'Lengua materna',sourceUrl:'https://www.astiberri.com/posts/novedades-astiberri-noviembre26'},
    {id:'ast-2026-11-genia',publisher:'Astiberri',month:'2026-11',date:'2026-11-12',title:'La pequeña genia y la noche de las brujas',series:'La pequeña genia',issueNr:'3',sourceUrl:'https://www.astiberri.com/posts/novedades-astiberri-noviembre26'},
    {id:'ast-2026-11-thb',publisher:'Astiberri',month:'2026-11',date:'2026-11-26',title:'Total THB. Volumen 1',series:'Total THB',issueNr:'1',sourceUrl:'https://www.astiberri.com/posts/novedades-astiberri-noviembre26'},
    {id:'ast-2026-11-ocupacion',publisher:'Astiberri',month:'2026-11',date:'2026-11-26',title:'La ocupación de los terrenos',series:'La ocupación de los terrenos',sourceUrl:'https://www.astiberri.com/posts/novedades-astiberri-noviembre26'},
    {id:'pla-2026-11-orgullo',publisher:'Planeta Cómic',month:'2026-11',title:'Orgullo y prejuicio (novela gráfica)',series:'Orgullo y prejuicio',sourceUrl:'https://www.planetadelibros.com/blog/revista-forum/articulo-ng-noviembre-26'},
    {id:'pla-2026-11-sacamantecas',publisher:'Planeta Cómic',month:'2026-11',title:'Sacamantecas',series:'Sacamantecas',sourceUrl:'https://www.planetadelibros.com/blog/revista-forum/articulo-ng-noviembre-26'},
    {id:'pla-2026-11-cult',publisher:'Planeta Cómic',month:'2026-11',title:'Cult of the Lamb nº 01',series:'Cult of the Lamb',issueNr:'1',sourceUrl:'https://www.planetadelibros.com/editorial/planeta-comic/54'},
    {id:'pla-2026-11-onepiece',publisher:'Planeta Cómic',month:'2026-11',title:'One Piece nº 114',series:'One Piece',issueNr:'114',sourceUrl:'https://www.planetadelibros.com/editorial/planeta-comic/54'},
    {id:'ast-2026-12-bass',publisher:'Astiberri',month:'2026-12',date:'2026-12-03',title:'Marshal Bass. Integral vol. 3',series:'Marshal Bass',issueNr:'3',sourceUrl:'https://www.astiberri.com/posts/novedades-astiberri-diciembre26'},
    {id:'ast-2026-12-pyongyang',publisher:'Astiberri',month:'2026-12',date:'2026-12-03',title:'Pyongyang. Edición cartoné',series:'Pyongyang',sourceUrl:'https://www.astiberri.com/posts/novedades-astiberri-diciembre26'},
    {id:'ast-2026-12-paracuellos',publisher:'Astiberri',month:'2026-12',date:'2026-12-03',title:'Paracuellos. Euskarazko edizioa',series:'Paracuellos',sourceUrl:'https://www.astiberri.com/posts/novedades-astiberri-diciembre26'},
    {id:'ast-2026-12-sucesos',publisher:'Astiberri',month:'2026-12',date:'2026-12-10',title:'Sucesos críticos variados. Volumen 2',series:'Sucesos críticos variados',issueNr:'2',sourceUrl:'https://www.astiberri.com/posts/novedades-astiberri-diciembre26'}
  ];
  const today=new Date(),state={month:today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0'),publisher:'',q:''};
  function safeUrl(u){try{const x=new URL(u);return x.protocol==='https:'?x.href:''}catch{return ''}}
  function dateLabel(x){if(!x.date)return 'Fecha exacta no publicada en la selección';const v=x.date.split('-');return v[2]+'/'+v[1]+'/'+v[0]}
  function matching(){
    return RELEASES.filter(x=>x.month===state.month&&(!state.publisher||state.publisher===x.publisher)&&
      (!state.q||norm([x.publisher,x.title,x.series,x.issueNr||''].join(' ')).includes(norm(state.q))));
  }
  async function view(){
    const items=matching();
    return head('Novedades editoriales','Publicaciones mensuales verificadas en las webs de las editoriales. Elige qué añadir a tu colección o Wishlist.')+
      '<div class="panel"><div class="filters">'+
        '<label>Mes <input id="new-month" type="month" value="'+esc(state.month)+'"></label>'+
        '<label>Editorial <select id="new-publisher"><option value="">Todas las editoriales</option>'+
          SOURCES.map(s=>'<option value="'+esc(s.name)+'" '+(state.publisher===s.name?'selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label>'+
        '<label>Buscar <input id="new-q" type="search" value="'+esc(state.q)+'" placeholder="Título o serie"></label></div>'+
      '<p class="small muted">No se copian portadas ni sinopsis; cada ficha enlaza a la publicación oficial. La lista es una selección contrastada, no un catálogo editorial completo ni una actualización automática.</p></div>'+
      (items.length?'<div class="grid">'+items.map(x=>'<article class="card"><div class="muted small">'+esc(x.publisher)+' · '+esc(dateLabel(x))+'</div>'+
        '<h3>'+esc(x.title)+'</h3><div class="muted">'+esc(x.series)+(x.issueNr?' · Nº '+esc(x.issueNr):'')+'</div>'+
        '<p><a href="'+esc(safeUrl(x.sourceUrl))+'" target="_blank" rel="noopener noreferrer">Ver publicación oficial</a></p>'+
        '<div class="actions"><button class="btn sm primary" data-release-id="'+esc(x.id)+'" data-release-status="In Collection">+ Colección</button> '+
        '<button class="btn sm" data-release-id="'+esc(x.id)+'" data-release-status="On Wish List">+ Wishlist</button></div></article>').join('')+'</div>':
        '<div class="notice">No tenemos entradas contrastadas para este mes y filtro. Consulta las fuentes oficiales y añade un cómic manualmente si no aparece aquí.</div>')+
      '<div class="panel"><h3>Consultar editoriales</h3><p class="muted small">Fuentes oficiales; sus contenidos e imágenes permanecen en las webs de origen.</p><div class="grid">'+
        SOURCES.map(s=>'<div><b>'+esc(s.name)+'</b><div class="small muted">'+esc(s.description)+'</div><a href="'+esc(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer">Consultar web oficial</a></div>').join('')+
      '</div></div>';
  }
  function afterRender(){
    const m=document.getElementById('new-month'),p=document.getElementById('new-publisher'),q=document.getElementById('new-q');
    if(m)m.onchange=()=>{state.month=m.value;render()};
    if(p)p.onchange=()=>{state.publisher=p.value;render()};
    if(q)q.onchange=()=>{state.q=q.value;render()};
    document.querySelectorAll('[data-release-id][data-release-status]').forEach(b=>b.onclick=()=>add(b.dataset.releaseId,b.dataset.releaseStatus));
  }
  async function add(id,status){
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
  window.MCNewReleases={view,afterRender,add};
})();
