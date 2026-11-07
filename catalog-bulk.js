'use strict';
/* Catalog batch operations and list/card switch. Only personal comics are modified. */
(function(){
  const selected=new Set();
  let view='cards';
  const originalView=catalogView;
  const originalRender=renderCat;
  const idSafe=id=>String(id).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const getVisible=async(wish)=>filtered(await allStore('comics'),wish);
  const label=x=>[x.publisher,x.catalogHeader||x.series,x.issueNr&&('#'+x.issueNr)].filter(Boolean).join(' · ');
  function toolbar(wish){
    return '<div class="mc-catalog-tools"><div class="mc-catalog-modes"><button type="button" class="btn sm" data-mc-view="cards" aria-pressed="'+(view==='cards')+'">▦ Fichas</button><button type="button" class="btn sm" data-mc-view="list" aria-pressed="'+(view==='list')+'">☷ Lista</button></div><label class="mc-catalog-check"><input type="checkbox" id="mc-select-page"> Seleccionar página</label><span id="mc-selection-count" aria-live="polite"></span><select id="mc-bulk-action" aria-label="Acción sobre los seleccionados"><option value="">Acción sobre seleccionados…</option><option value="In Collection">Pasar a colección</option><option value="On Wish List">Pasar a wishlist</option><option value="other">Cambiar estado</option><option value="publisher">Cambiar editorial</option><option value="group">Cambiar grupo / universo</option><option value="arc">Cambiar arco argumental</option><option value="tags">Añadir tags</option><option value="delete">Eliminar del catálogo personal</option></select><button type="button" class="btn sm primary" id="mc-apply-bulk">Aplicar</button></div>';
  }
  catalogView=async function(wish=false){
    const html=await originalView(wish);
    selected.clear();
    return html.replace('<div id="catbody"></div>',toolbar(wish)+'<div id="catbody"></div>');
  };
  function updateCount(){
    const count=document.getElementById('mc-selection-count');
    if(count)count.textContent=selected.size+' seleccionados';
    document.querySelectorAll('#catbody [data-mc-select]').forEach(el=>{el.checked=selected.has(el.dataset.mcSelect)});
    const all=[...document.querySelectorAll('#catbody [data-mc-select]')];
    const selectPage=document.getElementById('mc-select-page');
    if(selectPage){selectPage.checked=!!all.length&&all.every(x=>x.checked);selectPage.indeterminate=all.some(x=>x.checked)&&!selectPage.checked}
  }
  function listHTML(rows){
    return '<div class="mc-catalog-list" role="table" aria-label="Listado de cómics">'+rows.map(x=>'<div class="mc-catalog-list-row" role="row"><input type="checkbox" data-mc-select="'+esc(x.id)+'" aria-label="Seleccionar '+esc(label(x))+'"><div class="mc-catalog-list-cover">'+img(x,'cover cardcover')+'</div><div class="mc-catalog-list-info"><strong>'+esc(x.catalogHeader||x.series||x.title||'Sin cabecera')+'</strong><small>'+esc([x.publisher,x.volume&&('Vol. '+x.volume),x.startYear,x.issueNr&&('#'+x.issueNr)].filter(Boolean).join(' · '))+'</small><small>'+esc(x.title||'')+'</small></div><div class="mc-catalog-list-status">'+statusPill(x.status)+'</div><button type="button" class="btn sm" data-mc-edit="'+esc(x.id)+'">Editar</button></div>').join('')+'</div>';
  }
  function openBulkDialog(wish){
    const action=document.getElementById('mc-bulk-action')?.value;
    if(!action){toast('Elige una acción');return}
    if(!selected.size){toast('Selecciona al menos un cómic');return}
    const labels={'In Collection':'Pasar a colección','On Wish List':'Pasar a wishlist',other:'Cambiar estado',publisher:'Cambiar editorial',group:'Cambiar grupo / universo',arc:'Cambiar arco argumental',tags:'Añadir tags',delete:'Eliminar del catálogo personal'};
    const needsValue=!['In Collection','On Wish List','delete'].includes(action);
    const choices=action==='other'?'<select id="mc-bulk-value"><option value="">Selecciona el estado…</option><option value="In Collection">En colección</option><option value="On Wish List">Wishlist</option><option value="For Sale">En venta</option><option value="Sold">Vendido</option><option value="On Loan">Prestado</option></select>':'<input id="mc-bulk-value" type="text" maxlength="250" placeholder="'+esc(({publisher:'Nueva editorial',group:'Nuevo grupo o universo',arc:'Nuevo arco argumental',tags:'Tags a añadir'})[action]||'Nuevo valor')+'">';
    const host=document.createElement('div');
    host.id='mc-bulk-dialog';
    host.className='mc-bulk-dialog';
    host.innerHTML='<div class="mc-bulk-dialog-card" role="dialog" aria-modal="true" aria-labelledby="mc-bulk-title"><h3 id="mc-bulk-title">'+esc(labels[action])+'</h3><p>Se aplicará a <strong>'+selected.size+'</strong> cómic(s) seleccionados.</p>'+(action==='delete'?'<p class="mc-bulk-danger">Se eliminarán de tu catálogo personal. No se puede deshacer; el Maestro no se modifica.</p>':needsValue?'<label for="mc-bulk-value">Nuevo valor</label>'+choices:'<p>Se actualizará el estado de los cómics seleccionados.</p>')+'<div id="mc-bulk-error" role="alert"></div><div class="mc-bulk-dialog-buttons"><button type="button" class="btn" id="mc-bulk-cancel">Cancelar</button><button type="button" class="btn primary" id="mc-bulk-confirm">'+(action==='delete'?'Eliminar seleccionados':'Confirmar cambios')+'</button></div></div>';
    document.body.appendChild(host);
    const close=()=>host.remove();
    host.addEventListener('click',e=>{if(e.target===host)close()});
    host.querySelector('#mc-bulk-cancel').onclick=close;
    host.querySelector('#mc-bulk-confirm').onclick=async()=>{
      const input=host.querySelector('#mc-bulk-value');
      const value=input?input.value.trim():null;
      if(needsValue&&!value){host.querySelector('#mc-bulk-error').textContent='Introduce o selecciona el nuevo valor.';input.focus();return}
      const confirmButton=host.querySelector('#mc-bulk-confirm');
      confirmButton.disabled=true;
      let changed=0;
      try{
        for(const id of [...selected]){
          const row=await getStore('comics',id);
          if(!row)continue;
          if(action==='delete')await delStore('comics',id);
          else{
            const next={...row};
            if(action==='other')next.status=value;
            else if(action==='tags'){
              const old=String(row.tags||'').split(/[,;]/).map(t=>t.trim()).filter(Boolean);
              for(const tag of value.split(/[,;]/).map(t=>t.trim()).filter(Boolean))if(!old.some(t=>norm(t)===norm(tag)))old.push(tag);
              next.tags=old.join(', ');
            }else next[['In Collection','On Wish List'].includes(action)?'status':action]=['In Collection','On Wish List'].includes(action)?action:value;
            await putStore('comics',next);
          }
          changed++;
        }
        selected.clear();
        close();
        await renderCat(wish);
        toast(changed+' cómic(s) actualizados');
      }catch(err){
        host.querySelector('#mc-bulk-error').textContent='No se pudieron completar todos los cambios. '+String(err?.message||err);
        confirmButton.disabled=false;
      }
    };
    host.querySelector('#mc-bulk-value')?.focus();
  }
  // Delegated controls survive page redraws and do not depend on per-render handlers.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-mc-view],#mc-apply-bulk,[data-mc-edit]');
    if(!button)return;
    if(!document.querySelector('.mc-catalog-tools'))return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const wish=current==='wishlist';
    if(button.hasAttribute('data-mc-view')){
      view=button.dataset.mcView;
      document.querySelectorAll('[data-mc-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      const root=document.getElementById('catbody');
      root?.classList.toggle('mc-list-mode',view==='list');
      // A layout switch must never depend on an asynchronous database render.
      document.querySelectorAll('[data-mc-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mcView===view)));
    }else if(button.id==='mc-apply-bulk')openBulkDialog(wish);
    else editComic(button.dataset.mcEdit);
  },true);
  document.addEventListener('change',event=>{
    const input=event.target;
    if(!document.querySelector('.mc-catalog-tools'))return;
    if(input.matches?.('#catbody [data-mc-select]')){
      if(input.checked)selected.add(input.dataset.mcSelect);
      else selected.delete(input.dataset.mcSelect);
      updateCount();
    }else if(input.matches?.('#mc-select-page')){
      document.querySelectorAll('#catbody [data-mc-select]').forEach(x=>{
        x.checked=input.checked;
        if(input.checked)selected.add(x.dataset.mcSelect);
        else selected.delete(x.dataset.mcSelect);
      });
      updateCount();
    }
  },true);
  // Capture checkbox pointer interactions without suppressing the native change event.
  document.addEventListener('click',event=>{
    const check=event.target.closest?.('#catbody [data-mc-select]');
    if(check)event.stopPropagation();
  },true);
  renderCat=async function(wish=false){
    const out=await originalRender(wish);
    const root=document.getElementById('catbody');
    if(!root)return out;
    const visible=await getVisible(wish);
    const pageRows=visible.slice((page-1)*PAGE,page*PAGE);
    if(view==='list'){
      // Preserve the same cards and IDs: CSS presents them as rows, without data loss.
    }
    {
      const cards=root.querySelectorAll('.comic-grid .comic-card');
      cards.forEach((card,i)=>{
        const row=pageRows[i];if(!row)return;
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';checkbox.className='mc-card-select';checkbox.dataset.mcSelect=row.id;checkbox.setAttribute('aria-label','Seleccionar '+label(row));
        checkbox.addEventListener('click',e=>e.stopPropagation());

        card.prepend(checkbox);
      });
    }
    root.querySelectorAll('[data-mc-select]').forEach(input=>{input.checked=selected.has(input.dataset.mcSelect)});
    root.querySelectorAll('[data-mc-edit]').forEach(btn=>btn.onclick=()=>editComic(btn.dataset.mcEdit));
    
    const pageSelect=document.getElementById('mc-select-page');
    
    
    root.classList.toggle('mc-list-mode',view==='list');
    updateCount();
    setTimeout(()=>window.CoverVault?.hydrate?.(root),0);
    return out;
  };
})();