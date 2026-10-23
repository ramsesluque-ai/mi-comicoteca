'use strict';
/* v59: hotfix definitivo del menú Portadas. Se carga el último para evitar que overrides posteriores de render dejen la vista vacía. */
(function(){
  if(typeof render!=='function'||typeof coversView!=='function'||typeof renderCovers!=='function') return;
  const previousRender=render;
  render=async function(){
    if(current==='covers'){
      const view=document.querySelector('#view');
      if(!view) return;
      view.innerHTML=await coversView();
      await renderCovers();
      return;
    }
    return previousRender();
  };
})();
