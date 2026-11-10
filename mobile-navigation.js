'use strict';
/* Control móvil independiente de las funciones de navegación existentes. */
(function(){
  const sidebar=document.querySelector('.side');
  const nav=sidebar?.querySelector('.nav');
  if(!sidebar||!nav)return;
  if(document.getElementById('mcMobileMenuToggle'))return;
  const toggle=document.createElement('button');
  toggle.id='mcMobileMenuToggle';
  toggle.type='button';
  toggle.className='mc-mobile-menu-toggle';
  toggle.setAttribute('aria-label','Abrir menú de navegación');
  toggle.setAttribute('aria-controls','mcMobileNav');
  toggle.setAttribute('aria-expanded','false');
  toggle.innerHTML='<span class="mc-menu-symbol" aria-hidden="true">☰</span><span class="mc-menu-label">Menú</span>';
  nav.id='mcMobileNav';
  sidebar.insertBefore(toggle,nav);
  const close=()=>{
    nav.classList.remove('mc-mobile-nav-open');
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','Abrir menú de navegación');
    toggle.querySelector('.mc-menu-symbol').textContent='☰';
  };
  const open=()=>{
    nav.classList.add('mc-mobile-nav-open');
    nav.scrollTop=0;
    toggle.setAttribute('aria-expanded','true');
    toggle.setAttribute('aria-label','Cerrar menú de navegación');
    toggle.querySelector('.mc-menu-symbol').textContent='×';
  };
  toggle.addEventListener('click',()=>nav.classList.contains('mc-mobile-nav-open')?close():open());
  // Event delegation also closes the menu for dynamically added account buttons.
  nav.addEventListener('click',e=>{
    if(e.target.closest('button'))close();
  });
  document.addEventListener('click',e=>{
    if(nav.classList.contains('mc-mobile-nav-open')&&!sidebar.contains(e.target))close();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&nav.classList.contains('mc-mobile-nav-open')){close();toggle.focus()}
  });
  window.addEventListener('resize',()=>{
    if(window.innerWidth>680&&nav.classList.contains('mc-mobile-nav-open'))close();
  });
})();
