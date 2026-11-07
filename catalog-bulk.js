'use strict';
/* Catalog batch operations and list/card switch. Only personal comics are modified. */
(function(){
  const selected=new Set();
  let view='cards';
  const originalView=catalogView;
  const originalRender=renderCat;
  const idSafe=id=>String(id).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const getVisible=async(wish)=>filtered(await allStore('comics'),wish);
  const label=x=>[x.publisher,x.catalogHeader||x.series,issueNumberLabel(x)].filter(Boolean).join(' · ');
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
    return '<div class="mc-catalog-list" role="table" aria-label="Listado de cómics">'+rows.map(x=>'<div class="mc-catalog-list-row" role="row"><input type="checkbox" data-mc-select="'+esc(x.id)+'" onclick="event.stopPropagation()" aria-label="Seleccionar '+esc(label(x))+'"><div class="mc-catalog-list-cover">'+img(x,'cover cardcover')+'</div><div class="mc-catalog-list-info"><strong>'+esc(x.catalogHeader||x.series||x.title||'Sin cabecera')+'</strong><small>'+esc([x.publisher,x.volume&&('Vol. '+x.volume),x.startYear,issueNumberLabel(x)].filter(Boolean).join(' · '))+'</small><small>'+esc(x.title||'')+'</small></div><div class="mc-catalog-list-status">'+statusPill(x.status)+'</div><button type="button" class="btn sm" data-mc-edit="'+esc(x.id)+'">Editar</button></div>').join('')+'</div>';
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
  let currentWish=false;
  let currentRows=[];
  function showView(){
    const root=document.getElementById('catbody');
    if(!root)return;
    const grid=root.querySelector('.comic-grid');
    const list=root.querySelector('.mc-catalog-list');
    if(view==='list'){
      if(grid)grid.hidden=true;
      if(!list){
        const host=document.createElement('div');
        host.innerHTML=listHTML(currentRows);
        const created=host.firstElementChild;
        (grid||root.firstElementChild)?.before(created);
      }
    }else{
      if(grid)grid.hidden=false;
      if(list)list.remove();
    }
    root.classList.toggle('mc-list-mode',view==='list');
    document.querySelectorAll('[data-mc-view]').forEach(button=>{
      const active=button.dataset.mcView===view;
      button.setAttribute('aria-pressed',String(active));
      button.classList.toggle('active',active);
    });
    root.querySelectorAll('[data-mc-select]').forEach(input=>{input.checked=selected.has(input.dataset.mcSelect)});
    updateCount();
    window.CoverVault?.hydrate?.(root);
  }
  function bindCatalogControls(){
    document.querySelectorAll('[data-mc-view]').forEach(button=>{
      button.onclick=event=>{
        event.preventDefault();
        view=button.dataset.mcView;
        showView();
      };
    });
    const apply=document.getElementById('mc-apply-bulk');
    if(apply)apply.onclick=event=>{event.preventDefault();openBulkDialog(currentWish)};
    const selectPage=document.getElementById('mc-select-page');
    if(selectPage)selectPage.onchange=()=>{
      for(const row of currentRows){
        if(selectPage.checked)selected.add(String(row.id));
        else selected.delete(String(row.id));
      }
      updateCount();
    };
    const root=document.getElementById('catbody');
    if(root&&!root.dataset.mcSelectionBound){
      root.dataset.mcSelectionBound='1';
      root.addEventListener('click',event=>{
        const edit=event.target.closest?.('[data-mc-edit]');
        if(edit){event.preventDefault();event.stopPropagation();editComic(edit.dataset.mcEdit)}
      });
      root.addEventListener('change',event=>{
        const input=event.target.closest?.('[data-mc-select]');
        if(!input)return;
        const id=input.dataset.mcSelect;
        if(input.checked)selected.add(id);else selected.delete(id);
        updateCount();
      });
    }
  }
  renderCat=async function(wish=false){
    currentWish=wish;
    const out=await originalRender(wish);
    const root=document.getElementById('catbody');
    if(!root)return out;
    const visible=await getVisible(wish);
    currentRows=visible.slice((page-1)*PAGE,page*PAGE);
    root.querySelectorAll('.comic-grid .comic-card').forEach((card,i)=>{
      const row=currentRows[i];if(!row)return;
      const input=document.createElement('input');
      input.type='checkbox';
      input.className='mc-card-select';
      input.dataset.mcSelect=String(row.id);
      input.addEventListener('click',event=>event.stopPropagation());
      input.setAttribute('aria-label','Seleccionar '+label(row));
      card.prepend(input);
    });
    bindCatalogControls();
    showView();
    return out;
  };
})();
