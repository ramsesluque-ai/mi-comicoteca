/* Theme preference is per browser only; never touches comics, covers or cloud sync. */
(function(){
 'use strict';
 var key='mc_display_theme_v1';
 function read(){try{return localStorage.getItem(key)==='light'?'light':'dark'}catch(_){return 'dark'}}
 function apply(mode){document.documentElement.setAttribute('data-mc-theme',mode);var b=document.getElementById('mcThemeToggle');if(b){var light=mode==='light';b.textContent=light?'☾ Modo oscuro':'☀ Modo claro';b.setAttribute('aria-label',light?'Activar modo oscuro':'Activar modo claro');b.setAttribute('aria-pressed',String(light));}}
 apply(read());
 function mount(){if(document.getElementById('mcThemeToggle'))return;var side=document.querySelector('.side');if(!side)return;var b=document.createElement('button');b.id='mcThemeToggle';b.type='button';b.addEventListener('click',function(){var next=document.documentElement.getAttribute('data-mc-theme')==='light'?'dark':'light';try{localStorage.setItem(key,next)}catch(_){}apply(next)});var nav=side.querySelector('.nav');if(nav)nav.insertAdjacentElement('afterend',b);else side.appendChild(b);apply(read())}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
