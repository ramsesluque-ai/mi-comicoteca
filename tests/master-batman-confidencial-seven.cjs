'use strict';
// Verifica el flujo de carga real del Maestro sin credenciales ni datos privados.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const manual = JSON.parse(fs.readFileSync('master-data/manual-additions.json', 'utf8'));
const newIssues = manual.items.filter(x => x.publisher === 'Planeta / DeAgostini' &&
  x.catalogHeader === 'Batman Confidencial' && x.startYear === '2009');
assert.deepEqual(newIssues.map(x => Number(x.issueNr)).sort((a,b)=>a-b), [5,6,7]);
assert.equal(new Set(newIssues.map(x=>x.id)).size, 3);
assert(newIssues.every(x => !x.coverUrl && !x.isbn), 'No inventar portadas ni ISBN');

const preserved = [1,2,3,4].map(n => ({
  id: 'gcd-original-' + n, publisher: 'Planeta / DeAgostini',
  catalogHeader: 'Batman Confidencial', series: 'Batman Confidencial',
  volume: '', stage: '', startYear: '2009',
  issueNr: String(n), issue: String(n), title: 'Batman Confidencial',
  coverUrl: 'https://example.test/portada-original-' + n + '.jpg'
}));
const index = {
  totalIssues: 160472, totalPublishers: 337, totalSeries: 5459,
  publishers: [{publisher:'Planeta / DeAgostini', issues:4, series:1, chunks:['stub-planeta']}]
};
const ctx = {
  console,
  window: {},
  document: {createElement: () => ({textContent:''}), head: {appendChild: () => {}}},
  masterView: null, renderMaster: null, openMasterCollection: null, addFromMaster: null,
  mcSEMasterIndex: async () => index,
  mcSEPublisherMeta: () => [],
  mcSEChunks: async () => preserved.map(x=>({...x})),
  mcSEOverrides: async () => ({}),
  mcSECode: () => '',
  mcSENorm: s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(),
  fetch: async url => ({
    ok: true,
    json: async () => String(url).includes('manual-additions') ? manual : {items: []}
  })
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('master-static.js','utf8'), ctx, {filename:'master-static.js'});
(async () => {
  const rows = await vm.runInContext("mcMasterLoadPublisher('Planeta / DeAgostini')",ctx);
  const grouped = vm.runInContext('mcMasterDistinctIssues',ctx)(rows);
  assert.equal(rows.length, 7, 'La colección debe tener 7 registros');
  assert.equal(grouped.length, 7, 'Deben mostrarse 7 números distintos');
  assert.deepEqual([...new Set(rows.map(x=>Number(x.issueNr)))].sort((a,b)=>a-b), [1,2,3,4,5,6,7]);
  const groupKey = vm.runInContext('mcMasterGroupKey',ctx);
  assert.equal(new Set(rows.map(groupKey)).size,1,'Los 7 números deben estar en la misma colección');
  for (const p of preserved) {
    const found = rows.find(x => x.id === p.id);
    assert.equal(found?.coverUrl,p.coverUrl,'Preservar la portada del número '+p.issueNr);
  }
  const counted = await vm.runInContext('mcMasterIndexWithArchive()',ctx);
  assert.equal(counted.publishers[0].issues, 4 + newIssues.length, 'El índice visual debe sumar las ampliaciones');
  console.log('PASS Maestro Batman Confidencial: 7 números, portadas originales intactas');
})().catch(e => {console.error(e);process.exitCode=1});
