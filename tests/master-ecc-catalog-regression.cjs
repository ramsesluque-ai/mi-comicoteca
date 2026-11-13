'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const rows=JSON.parse(fs.readFileSync('master-data/publishers/ecc-001.json','utf8'));
assert(rows.length>=2500,'ECC catalog unexpectedly truncated');
assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,'duplicate GCD record identifiers');
const reviewedNames=new Set(['100 Balas','52','Adam y Eve','American Vampire','Animal Man: El Reino Rojo','¡Scooby-Doo! y Sus Amigos']);
const counts={
 '100 Balas|1':10,'100 Balas|2':5,'52|':4,'Adam y Eve|':2,
 'American Vampire|':16,'Animal Man: El Reino Rojo|':1,
 'Antes de Watchmen: Búho Nocturno|':4,'Antes de Watchmen: Dollar Bill|':1,
 'Antes de Watchmen: Dr. Manhattan|1':4,'Antes de Watchmen: Dr. Manhattan|2':1,
 'Antes de Watchmen: El Comediante|':6,'Antes de Watchmen: Espectro de Seda|':4,
 'Antes de Watchmen: Minutemen|':6,'Antes de Watchmen: Moloch|':2,
 'Antes de Watchmen: Ozymandias|':6,'Antes de Watchmen: Rorschach|':4,
 '¡Scooby-Doo! y Sus Amigos|':10
};
const reviewed=rows.filter(r=>reviewedNames.has(r.catalogHeader)||r.catalogHeader?.startsWith('Antes de Watchmen:'));
assert.equal(reviewed.length,86,'reviewed ECC records must be preserved');
for(const [key,n] of Object.entries(counts)){
 const [head,vol]=key.split('|');
 assert.equal(reviewed.filter(r=>r.catalogHeader===head&&String(r.volume||'')===vol).length,n,'unexpected series count: '+key);
}
for(const r of reviewed){
 assert(r.title&&r.title!=='-1','missing reviewed title '+r.id);
 assert(r.publicationDate!=='-1','invalid date '+r.id);
 assert(r.isbn!=='-1','invalid ISBN '+r.id);
}
assert(!rows.some(r=>r.publicationDate==='-1'),'unresolved invalid ECC publication date');
const scooby=reviewed.filter(r=>r.catalogHeader==='¡Scooby-Doo! y Sus Amigos');
assert.equal(scooby.length,10);
for(const s of scooby){assert.equal(s.pages,'72');assert.match(s.title,/N.º\s+[1-9]|N.º\s+10/);}
const html=fs.readFileSync('index.html','utf8'),engine=fs.readFileSync('search-engine.js','utf8');
for(const file of ['search-engine.js','master-static.js','master-series-ui.js']){
 assert(new RegExp(file.replace(/\\./g,'\\\\.')+'\\\\?v=[^"\\\\s]+').test(html),'Maestro asset is missing a cache version: '+file);
}
assert(engine.includes("MC_ECC_CATALOG_REV='20261112-ecc-refresh1'"),'ECC data query must use new revision');
assert(engine.includes("cache:eccChunk?'no-cache':'force-cache'"),'ECC data cache must revalidate');
console.log('MASTER_ECC_CATALOG_REGRESSION_PASS reviewed='+reviewed.length+' rows='+rows.length);
