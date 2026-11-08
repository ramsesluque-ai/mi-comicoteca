'use strict';
/* v26: resolver edición española con Cabecera + Etapa y eliminar enlaces externos de fallback. */
const MC_BUILD_V26='v26';

mcSearchNameVariants=function(x){
  const base=[x.catalogHeader,x.series,x.title].filter(Boolean),stage=String(x.stage||'').trim(),pub=norm(x.publisher),out=[];
  const add=v=>{v=String(v||'').replace(/\s+/g,' ').trim();if(v&&!out.some(z=>norm(z)===norm(v)))out.push(v)};
  for(const raw of base){
    add(raw);
    if(stage){add(`${raw}: ${stage}`);add(`${raw} ${stage}`);add(`${raw} - ${stage}`)}
    const parts=String(raw).split(/\s+-\s+/).map(s=>s.trim()).filter(Boolean);
    if(parts.length>1){add(parts[0]);const withoutPub=parts.filter(p=>norm(p)!==pub).join(' - ');add(withoutPub);if(stage){add(`${parts[0]}: ${stage}`);add(`${withoutPub}: ${stage}`)}}
    if(x.publisher){const rx=new RegExp('\\s*[-–—:]?\\s*'+String(x.publisher).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$','i');const clean=String(raw).replace(rx,'');add(clean);if(stage)add(`${clean}: ${stage}`)}
    add(String(raw).replace(/\s*\((?:vol\.?|volumen|serie|etapa)[^)]*\)\s*$/i,''));
  }
  return out.slice(0,10);
};

mcNoCompleteResult=function(x,quick=false){
  return `<div class="notice"><b>No se ha encontrado todavía una coincidencia completa.</b><br>MI COMICOTECA solo mostrará resultados con <b>portada + datos bibliográficos + número exacto</b>. La búsqueda permanece dentro de la aplicación.</div><div class="result-actions" style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px"><button class="btn" type="button" onclick="${quick?'mcCancelSeriesQuick()':'mcCancelUnified()'}">Cancelar</button></div>`;
};

(function(){
  const put=()=>{const el=document.getElementById('mc-build-badge');if(el)el.textContent='MI COMICOTECA '+MC_BUILD_V26};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',put);else put();
})();
