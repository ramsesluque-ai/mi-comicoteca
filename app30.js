'use strict';
/* v41: el Maestro puede resolver portadas persistentes tanto por ISBN como por sourceId exacto de GCD. */
(function(){
  if(typeof mcSEFromRow!=='function'||typeof mcSECode!=='function')return;
  const base=mcSEFromRow;
  mcSEFromRow=function(x,r,overrides){
    const over=overrides||{},isbn=mcSECode(r?.isbn||r?.barcode||''),sid=String(r?.sourceId||'').trim();
    const byIsbn=isbn?over[isbn]:null,byGcd=sid?over['gcd:'+sid]:null;
    if(byIsbn||!byGcd)return base(x,r,over);
    const local=Object.create(over);local[isbn]=byGcd;
    return base(x,r,local);
  };
  window.mcSEFromRow=mcSEFromRow;
})();
