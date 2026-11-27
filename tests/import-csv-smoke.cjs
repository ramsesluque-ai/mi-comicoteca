'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('app5.js','utf8');
const take=(start,end)=>{const a=src.indexOf(start),b=src.indexOf(end,a);assert(a>=0&&b>a);return src.slice(a,b)};
let saved;const ctx={download:(...args)=>saved=args};vm.createContext(ctx);
vm.runInContext(take('function mcImportParseCsv(text){','function mcImportMap(raw){')+take('function mcImportTemplate(){','async function backupView()'),ctx);
ctx.mcImportTemplate();
assert.equal(saved[0],'COMICTECA_plantilla_importacion.csv');
assert(saved[1].startsWith('\uFEFF'));
assert(!saved[1].includes('ECC'));
assert(saved[1].includes('Año de inicio'));
assert.equal(ctx.mcImportParseCsv(saved[1]).length,0);
const row='\uFEFF"Editorial";"Cabecera";"Año de inicio";"Número";"Título"\r\n"ECC";"Batman";"2016";"1";"Año Uno"\r\n';
const parsed=ctx.mcImportParseCsv(row);
assert.equal(parsed.length,1);assert.equal(parsed[0]['Título'],'Año Uno');
assert.equal(parsed[0]['Número'],'1');
const multi=ctx.mcImportParseCsv('Editorial;Título\nECC;"Título con; separador y\nsalto de línea"\n');
assert.equal(multi[0]['Título'],'Título con; separador y\nsalto de línea');
console.log('PASS: Excel BOM, template header-only, UTF-8 accents, CRLF, quoted delimiters and multiline fields');

// Regression: the import preview must remove the modal's initial hidden class.
const importer=take("async function importFile(file,target='comics'){",'async function mcImportConfirm(){');
assert.match(importer,/modal[.]classList[.]remove[(]['\"]hidden['\"][)]/,'Preview must be visible');
assert.doesNotMatch(importer,/modal[.]classList[.]add[(]['\"]show['\"][)]/,'show alone leaves hidden modal invisible');
const app1=fs.readFileSync('app1.js','utf8');
assert.match(app1,/comicteca-importacion-prueba-v2/,'Test mode must use fresh independent IndexedDB');
assert.match(importer,/mcImportIdentityConflict/,'Importer must quarantine ambiguous collection identities');
const index=fs.readFileSync('index.html','utf8');
assert.match(index,/ENTORNO DE PRUEBA DE IMPORTACIÓN/,'Test mode must be clearly labeled');
console.log('PASS: import preview visible and test database isolated');

// Execute the actual importer identity check: blank metadata must never be
// silently assigned to an existing edition, while distinct known editions
// remain separate and different publishers/issues do not collide.
const conflictSource=take('function mcImportIdentityConflict(a,b){','let mcImportPending=null;');
vm.runInContext(conflictSource,ctx);
const base={publisher:'ECC',catalogHeader:'Batgirl',issueNr:'1'};
const known={...base,volume:'1',startYear:'2012'};
const unknown={...base,volume:'',stage:'',startYear:''};
assert.equal(ctx.mcImportIdentityConflict(unknown,known),true);
assert.equal(ctx.mcImportIdentityConflict(known,unknown),true);
assert.equal(ctx.mcImportIdentityConflict(known,{...known,volume:'2',startYear:'2015'}),false);
assert.equal(ctx.mcImportIdentityConflict(unknown,{...known,publisher:'Planeta DeAgostini'}),false);
assert.equal(ctx.mcImportIdentityConflict(unknown,{...known,issueNr:'2'}),false);
console.log('PASS: ambiguous Batgirl editions quarantined; different publisher, edition and issue preserved');

// Independent classification: import, editor, both save paths and dashboard.
assert(saved[1].includes('"Universo";"Personaje";"Personajes"'));
ctx.cleanComic=x=>x;
vm.runInContext(take('function mcImportMap(raw){','function mcImportKey('),ctx);
const classified=ctx.mcImportMap({Universo:'DC',Personaje:'Batman',Grupo:'Histórico',Personajes:'Robin'});
assert.equal(classified.universe,'DC');assert.equal(classified.character,'Batman');assert.equal(classified.group,'Histórico');assert.equal(classified.characters,'Robin');
const editor=fs.readFileSync('app3.js','utf8'),save=fs.readFileSync('app4.js','utf8'),cover=fs.readFileSync('app8.js','utf8');
assert(editor.includes("fld('universe','Universo',r.universe)"));assert(editor.includes("fld('character','Personaje',r.character)"));
assert(save.includes("personaje:'character',character:'character'"));
assert.equal((cover.match(/character:document\.getElementById\('m_character'\)/g)||[]).length,2);
const dash=fs.readFileSync('dashboard-pbi.js','utf8');const start=dash.indexOf('  function universeName(x)'),end=dash.indexOf('  function drillRows(rows)',start);
vm.runInContext(dash.slice(start,end),ctx);
assert.equal(ctx.universeName({universe:'DC',character:'Batman',group:'Lobezno'}),'DC');
assert.equal(ctx.characterName({universe:'DC',character:'Batman',group:'Lobezno'}),'Batman');
assert.equal(ctx.characterName({group:'Lobezno'}),'Sin identificar');assert.equal(ctx.universeName({group:'Lobezno'}),'Sin identificar');
console.log('PASS: independent character and universe classifications');
