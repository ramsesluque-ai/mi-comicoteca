'use strict';
(function(){
 const modal=document.getElementById('modal');
 const inject=()=>{
   if(!modal||!modal.querySelector('.syncbox')||modal.querySelector('#initialImportBox'))return;
   const body=modal.querySelector('.modalbody');if(!body)return;
   const box=document.createElement('div');box.id='initialImportBox';box.className='notice oknotice';
   box.innerHTML='<b>Primera puesta en marcha</b><div class="small" style="margin:6px 0 10px">Si este dispositivo está vacío, carga aquí la copia inicial. Después pulsa “Guardar ahora” y ya no volverás a necesitar importar archivos en los demás dispositivos.</div><label class="btn primary">Importar copia inicial<input class="hidden" type="file" accept=".json" id="initialImportFile"></label>';
   body.insertBefore(box,body.children[1]||null);
   box.querySelector('#initialImportFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;await importFile(f,'comics');CloudSync.show();};
 };
 new MutationObserver(inject).observe(modal,{childList:true,subtree:true});
 inject();
})();