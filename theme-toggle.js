/* Theme preference is per browser only; never touches comics, covers or cloud sync. */
(function(){
 'use strict';
 var key='mc_display_theme_v1';
 function read(){try{return localStorage.getItem(key)==='light'?'light':'dark'}catch(_){return 'dark'}}
 function apply(mode){document.documentElement.setAttribute('data-mc-theme',mode);var b=document.getElementById('mcThemeToggle');if(b){var light=mode==='light';b.textContent=light?'☾ Modo oscuro':'☀ Modo claro';b.setAttribute('aria-label',light?'Activar modo oscuro':'Activar modo claro');b.setAttribute('aria-pressed',String(light));}}
 apply(read());
 var button=null;
 function mount(){
   var actions=document.querySelector('#view .top .actions');
   if(!actions)return;
   if(!button){
     button=document.createElement('button');button.id='mcThemeToggle';button.type='button';button.className='btn sm';
     button.addEventListener('click',function(){var next=document.documentElement.getAttribute('data-mc-theme')==='light'?'dark':'light';try{localStorage.setItem(key,next)}catch(_){}apply(next)});
   }
   /* Place beside Add Comic when present; otherwise at the top of the page. */
   if(button.parentNode!==actions)actions.appendChild(button);
   apply(read());
 }
 function start(){
   mount();
   var view=document.getElementById('view');
   if(view){var observer=new MutationObserver(function(){mount()});observer.observe(view,{childList:true,subtree:false});}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
