'use strict';
/* v69: garantiza que Dashboard renderiza el dashboard y no la vista Catálogo. */
(function(){
  if(typeof window.render!=='function')return;
  const previousRender=window.render;
  window.render=render=async function(){
    /* Dashboard se resuelve de forma explícita antes de cualquier wrapper de Catálogo. */
    if(current==='dashboard'){
      const html=await window.dashboard();
      const view=document.querySelector('#view');
      if(view)view.innerHTML=html;
      try{setNav('dashboard')}catch{}
      return;
    }
    return previousRender();
  };
  /* Reasigna navegación al final de la cadena de parches para evitar handlers antiguos. */
  document.querySelectorAll('.nav button').forEach(b=>{
    b.onclick=async()=>{
      const v=b.dataset.v;
      current=v;page=1;filters={};masterCollection=null;
      try{setNav(v)}catch{}
      await window.render();
    };
  });
})();
