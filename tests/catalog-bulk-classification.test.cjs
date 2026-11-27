'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','catalog-bulk.js'),'utf8');
const start=src.indexOf('  function applyBulkChange('),end=src.indexOf('  function openBulkDialog(',start);
assert(start>=0&&end>start);
const ctx={norm:v=>String(v).toLowerCase()};vm.runInNewContext(src.slice(start,end),ctx);
const change=ctx.applyBulkChange;
const row={id:'test',group:'Historico',universe:'Marvel',character:'Lobezno',status:'On Wish List',coverKey:'private',title:'Original'};
test('bulk universe writes the field read by the editor and preserves character, legacy and cover',()=>{
 const next=change(row,'universe','DC');assert.equal(next.universe,'DC');assert.equal(next.character,'Lobezno');assert.equal(next.group,'Historico');assert.equal(next.coverKey,'private');assert.equal(next.status,row.status);assert.equal(row.universe,'Marvel');
});
test('bulk character is independent of universe and historical grouping',()=>{
 const next=change(row,'character','Batman');assert.equal(next.character,'Batman');assert.equal(next.universe,'Marvel');assert.equal(next.group,'Historico');assert.equal(next.id,row.id);assert.equal(next.title,row.title);
});
test('menu exposes both fields, not legacy group, and uses tracked save',()=>{
 assert(src.includes('<option value="universe">Cambiar universo</option>'));assert(src.includes('<option value="character">Cambiar personaje</option>'));assert(!src.includes('<option value="group">'));assert(src.includes("await putStore('comics',next)"));
 assert.throws(()=>change(row,'group','DC'),/no admitida/);
});
