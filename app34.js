'use strict';
/* v48: auditoría y reparación de portadas ya existentes.
   - conserva subidas manuales desde archivo;
   - reemplaza por la portada exacta del Maestro/Tebeosfera cuando existe;
   - retira portadas recientes no verificables y portadas demostrablemente asociadas a otra ficha.
*/
(function(){
  if(!window.CoverVault||typeof allStore!=='function'||typeof putStore!=='function'||typeof mcSEOverrides!=='function')return;

  const FLAG='mc_cover_repair_v48_done';
  const CACHE='mi-comicoteca-cover-vault-v1';
  const MAX_PER_PASS=80;
  let running=false,timer=null,last={checked:0,replaced:0,removed:0,preserved:0,errors:0,remaining:0};
  const code=v=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const safe=s=>String(s||'cover').replace(/[^a-zA-Z0-9_.-]/g,'_');
  const cacheUrl=k=>'https://mi-comicoteca.local/cover/'+encodeURIComponent(safe(k));
  const isHttp=v=>/^https?:\/\//i.test(String(v||''));
  const normUrl=v=>String(v||'').trim().replace(/^http:/i,'https:').replace(/[?#].*$/,'');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function manual(x){const s=String(x?.coverSourceUrl||'').trim().toLowerCase();return s==='archivo local'||s==='local file'||s.startsWith('data:image/')}
  function keysFor(x){
    const out=[],isbn=code(x?.isbn||x?.barcode||'');if(isbn)out.push(isbn);
    const sid=String(x?.sourceId||'').trim();if(sid)out.push('gcd:'+sid);
    if(typeof window.mcMasterCompositeCoverKey==='function'){const k=window.mcMasterCompositeCoverKey(x);if(k)out.push(k)}
    if(typeof window.mcMasterCompositeCoverKeyNoVolume==='function'){const k=window.mcMasterCompositeCoverKeyNoVolume(x);if(k&&!out.includes(k))out.push(k)}
    return out;
  }
  function exactOverride(x,over){for(const k of keysFor(x))if(over?.[k]?.coverUrl)return{k,o:over[k]};return null}
  function exactUrl(m){return String(m?.o?.coverUrl||(Array.isArray(m?.o?.coverUrls)?m.o.coverUrls[0]:'')||'').trim()}
  function reverseMap(over){const m=new Map();for(const [k,o] of Object.entries(over||{})){const u=normUrl(o?.coverUrl||(Array.isArray(o?.coverUrls)?o.coverUrls[0]:'')||'');if(!u)continue;if(!m.has(u))m.set(u,new Set());m.get(u).add(k)}return m}
  function provablyWrong(x,reverse){const u=normUrl(x?.coverSourceUrl||x?.coverUrl||'');if(!u||!reverse.has(u))return false;const expected=new Set(keysFor(x));for(const k of reverse.get(u))if(expected.has(k))return false;return true}
  async function detach(x){
    try{if(x?.coverKey){const c=await caches.open(CACHE);await c.delete(cacheUrl(x.coverKey))}}catch{}
    const updated={...x,coverKey:'',coverSourceUrl:'',coverUrl:'',coverSyncPending:false,coverSyncedAt:'',coverRepair:'removed-v48'};
    await putStore('comics',updated);return updated;
  }

  async function plan(){
    const [over,rows]=await Promise.all([mcSEOverrides(),allStore('comics')]);const reverse=reverseMap(over),targets=[];let preserved=0;
    for(const x of rows){
      if(!x||x.status!=='In Collection'||!x.coverKey)continue;
      if(manual(x)){preserved++;continue}
      const m=exactOverride(x,over),u=exactUrl(m),cur=normUrl(x.coverSourceUrl||'');
      if(u){if(cur&&cur===normUrl(u)){preserved++;continue}targets.push({type:'replace',x,u});continue}
      if((x.coverSyncPending===true&&isHttp(x.coverSourceUrl))||provablyWrong(x,reverse)){targets.push({type:'remove',x});continue}
      preserved++;
    }
    return{targets,preserved};
  }

  async function run(force=false){
    if(running||window.__mcCatalogReconcileRunning||document.visibilityState==='hidden')return last;
    if(!force&&localStorage.getItem(FLAG)==='1')return last;
    const rows=await allStore('comics');if(!rows.length){schedule(1800);return last}
    running=true;window.__mcCoverRepairRunning=true;const prevBatch=!!window.__mcCoverBatchRunning;window.__mcCoverBatchRunning=true;
    try{
      const p=await plan(),batch=p.targets.slice(0,MAX_PER_PASS);let replaced=0,removed=0,errors=0;
      for(const t of batch){try{if(t.type==='replace'){await window.CoverVault.attach(t.x,t.u,{sync:false});replaced++}else{await detach(t.x);removed++}}catch(e){console.warn('Repair cover',t.x?.id,e);errors++}await sleep(60)}
      last={checked:batch.length,replaced,removed,preserved:p.preserved,errors,remaining:Math.max(0,p.targets.length-batch.length)};
      if(last.remaining>0){schedule(500)}else{
        localStorage.setItem(FLAG,'1');
        if(typeof toast==='function'&&(replaced||removed))toast(`Portadas revisadas: ${replaced} corregida${replaced===1?'':'s'} · ${removed} retirada${removed===1?'':'s'}`);
        setTimeout(()=>window.mcAutoImportMasterCovers?.schedule?.(0),400);
      }
      return last;
    }catch(e){console.warn('CoverRepair',e);return last}
    finally{window.__mcCoverBatchRunning=prevBatch;window.__mcCoverRepairRunning=false;running=false;try{window.CloudSync?.schedule?.()}catch{}try{if(typeof window.renderCovers==='function'&&document.querySelector('#mcCoverControls'))await window.renderCovers()}catch{}}
  }
  function schedule(delay=700){clearTimeout(timer);timer=setTimeout(()=>run(false),Math.max(100,Number(delay)||700))}
  function rerun(){localStorage.removeItem(FLAG);return run(true)}
  window.mcRepairExistingCovers={run,rerun,status:()=>({...last,running})};
  window.addEventListener('load',()=>schedule(900));window.addEventListener('focus',()=>{if(localStorage.getItem(FLAG)!=='1')schedule(700)});
})();