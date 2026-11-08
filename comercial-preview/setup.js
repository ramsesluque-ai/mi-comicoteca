'use strict';
(function(){
 const modal=document.getElementById('modal');
 async function importInitialFile(file){
   if(/\.zip$/i.test(file.name)){
     busy(true,'Abriendo copia ZIP…');
     try{
       const files=await unzipXlsx(await file.arrayBuffer());
       const name=Object.keys(files).find(n=>/\.json$/i.test(n));
       if(!name)throw Error('El ZIP no contiene una copia JSON');
       const virtual=new File([files[name]],name,{type:'application/json'});
       await importFile(virtual,'comics');
     }catch(e){console.error(e);toast('Error: '+(e.message||e));}
     finally{busy(false)}
   }else await importFile(file,'comics');
   CloudSync.show();
 }
 const inject=()=>{
   if(!modal||!modal.querySelector('.syncbox')||modal.querySelector('#initialImportBox'))return;
   const body=modal.querySelector('.modalbody');if(!body)return;
   const box=document.createElement('div');box.id='initialImportBox';box.className='notice oknotice';
   box.innerHTML='<b>Primera puesta en marcha</b><div class="small" style="margin:6px 0 10px">Si este dispositivo está vacío, carga aquí la copia inicial JSON o ZIP. Después pulsa “Guardar ahora” y los demás dispositivos cargarán la misma colección cifrada.</div><label class="btn primary">Importar copia inicial<input class="hidden" type="file" accept=".json,.zip,application/zip" id="initialImportFile"></label>';
   body.insertBefore(box,body.children[1]||null);
   box.querySelector('#initialImportFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;await importInitialFile(f);e.target.value='';};
 };
 new MutationObserver(inject).observe(modal,{childList:true,subtree:true});
 inject();
})();