'use strict';
/* Admin-only batch cover publication for Novaro Batman 1..150.
 * Files are selected by the administrator in the authenticated browser.
 * Each cover is uploaded privately, then published via the existing
 * server-side publish-master-cover function; no direct public bucket writes.
 */
(function(){
 const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1';
 const config=()=>window.MI_COMICOTECA_CLOUD||{};
 const session=()=>{for(const storage of [sessionStorage,localStorage]){try{const s=JSON.parse(storage.getItem('mc_supabase_session_v1')||'null');if(s?.access_token&&s?.user?.id)return s}catch(_){}}return null};
 const numberOf=file=>{const m=/^(?:batman[_ -]*)?0*([1-9][0-9]{0,2})\.(?:jpg|jpeg|png|webp)$/i.exec(file.name);return m?Number(m[1]):0};
 async function run(files,status,button){
  const c=config(),s=session();
  if(!s||s.user.id!==OWNER||!c.url||!c.publishableKey)throw Error('Acceso reservado al administrador');
  const h={apikey:c.publishableKey,Authorization:'Bearer '+s.access_token};
  const me=await fetch(c.url+'/auth/v1/user',{headers:h});
  const user=await me.json().catch(()=>({}));
  if(!me.ok||user.id!==OWNER)throw Error('No se ha verificado la sesión del administrador');
  const rows=await window.mcMasterLoadPublisher('Novaro');
  const matches=new Map();
  for(const row of rows){
   const n=Number(row.issueNr||row.issue);
   if(n<1||n>150||!Number.isInteger(n))continue;
   if(String(row.catalogHeader||row.series||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()!=='batman')continue;
   if(/avestruz|colibri/.test(String(row.stage||'').toLowerCase()))continue;
   if(!matches.has(n))matches.set(n,[]);
   matches.get(n).push(row);
  }
  const selected=new Map();
  for(const file of files){
   const n=numberOf(file);
   if(!n||n>150)throw Error('Nombre de archivo no reconocido: '+file.name);
   if(selected.has(n))throw Error('Número repetido: '+n);
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>5242880)throw Error('Imagen inválida o mayor de 5 MB: '+file.name);
   selected.set(n,file);
  }
  if(!selected.size)throw Error('Selecciona imágenes JPG, PNG o WebP');
  for(const n of selected.keys())if(!matches.has(n))throw Error('No existe ficha de Batman Novaro n.º '+n);
  const approved=await window.mcSharedCovers(true);
  const jobs=[];
  for(const [n,file] of [...selected].sort((a,b)=>a[0]-b[0])){
   const options=matches.get(n);
   const primary=options.find(r=>!String(r.stage||'').toLowerCase().includes('aguila'))||options[0];
   const identity=window.mcMasterCoverKey(primary);
   if(!identity)throw Error('Identidad bibliográfica no verificable: '+n);
   if(approved[identity])continue; // Never replace existing published covers.
   jobs.push({n,file,identity,isbn:primary.isbn||null});
  }
  if(!confirm('Publicar '+jobs.length+' portadas nuevas de Batman Novaro en el Maestro compartido? Las '+(selected.size-jobs.length)+' ya publicadas se omitirán.'))return;
  button.disabled=true;
  let done=0;
  try{
   for(const job of jobs){
    status.textContent='Publicando '+(done+1)+'/'+jobs.length+' · Batman n.º '+job.n;
    const ext=job.file.type==='image/png'?'png':job.file.type==='image/webp'?'webp':'jpg';
    const path=OWNER+'/'+crypto.randomUUID()+'.'+ext;
    const upload=await fetch(c.url+'/storage/v1/object/master-contributions/'+path,{method:'POST',headers:{...h,'Content-Type':job.file.type,'x-upsert':'false'},body:job.file});
    if(!upload.ok)throw Error('Fallo al subir n.º '+job.n+' (HTTP '+upload.status+')');
    const response=await fetch(c.url+'/functions/v1/publish-master-cover',{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({private_path:path,identity_key:job.identity,isbn:job.isbn})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw Error('No se publicó n.º '+job.n+': '+(data.error||response.status));
    done++;
   }
   await window.mcSharedCovers(true);
   status.textContent='Publicadas '+done+' portadas. Abre de nuevo la colección para verlas.';
  }finally{button.disabled=false}
 }
 window.mcNovaroBulkMount=function(){
  const body=document.getElementById('masterbody');
  if(!body||body.querySelector('#mcNovaroBulk')||String(window.filters?.publisher||'').toLowerCase()!=='novaro')return;
  const s=session();if(s?.user?.id!==OWNER)return;
  const wrapper=document.createElement('div');
  wrapper.id='mcNovaroBulk';
  wrapper.className='panel';
  const title=document.createElement('strong');title.textContent='Portadas Batman Novaro · carga de administrador';
  const info=document.createElement('p');info.className='muted';info.textContent='Extrae el ZIP y selecciona las imágenes 1.jpg a 150.jpg. Se publican solo portadas ausentes, una por una.';
  const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='image/jpeg,image/png,image/webp';
  const button=document.createElement('button');button.className='btn primary';button.type='button';button.textContent='Publicar portadas seleccionadas';
  const status=document.createElement('span');status.setAttribute('role','status');status.style.marginLeft='12px';
  button.onclick=async()=>{try{await run(Array.from(input.files||[]),status,button)}catch(e){status.textContent='Error: '+e.message}};
  wrapper.append(title,info,input,button,status);
  body.prepend(wrapper);
 };
})();
