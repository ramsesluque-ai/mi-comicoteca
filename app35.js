'use strict';
/* v47: equivalencias controladas de cabecera/título entre Catálogo y Maestro. */
(function(){
  if(typeof mcSESeriesScore!=='function'||typeof mcSENorm!=='function')return;
  const baseScore=mcSESeriesScore;

  function canonical(v){
    return mcSENorm(v)
      .replace(/[‐‑–—]/g,'-')
      .replace(/\b(el\s+)?hombre\s+murcielago\b/g,'batman')
      .replace(/\bbatman\s+el\s+batman\b/g,'batman')
      .replace(/\b(el\s+)?hombre\s+arana\b/g,'spiderman')
      .replace(/\bspider[-\s]?man\b/g,'spiderman')
      .replace(/\bsuper[-\s]?man\b/g,'superman')
      .replace(/\bserie\s+(aguila|avestruz|colibri)\b/g,' ')
      .replace(/\b(formato\s+)?(aguila|avestruz|colibri)\b/g,' ')
      .replace(/\bnovaro\b|\bediciones?\b|\beditorial\b/g,' ')
      .replace(/[^a-z0-9áéíóúüñ]+/gi,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function tokens(v){
    const stop=new Set(['de','del','la','el','los','las','y','e','vol','volumen','serie','etapa']);
    return [...new Set(canonical(v).split(/\s+/).filter(x=>x&&x.length>1&&!stop.has(x)))];
  }

  function aliasScore(a,b){
    const ca=canonical(a),cb=canonical(b);
    if(!ca||!cb)return 0;
    if(ca===cb)return 1;
    const A=tokens(ca),B=tokens(cb);
    if(!A.length||!B.length)return 0;
    const inter=A.filter(x=>B.includes(x)).length;
    const containment=Math.max(inter/A.length,inter/B.length);
    /* No convertir una simple coincidencia parcial en identidad total. */
    return inter&&containment>=0.75?containment:0;
  }

  mcSESeriesScore=function(a,b){
    return Math.max(baseScore(a,b),aliasScore(a,b));
  };
  window.mcSESeriesScore=mcSESeriesScore;
  window.mcCanonicalSeriesHeader=canonical;
})();