'use strict';
// COMICTECA: static smoke checks; browser rendering and backend tests are separate.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const html=read('index.html'), app=read('app5.js'), bi=read('dashboard-pbi.js'), css=read('dashboard-pbi.css'), sw=read('sw.js');
const checks=[
  ['dashboard navigation',()=>assert.match(html,/data-v="dashboard"/)],
  ['BI JavaScript linked',()=>assert.match(html,/src="dashboard-pbi\.js\?v=[A-Za-z0-9_-]+"/)],
  ['BI CSS linked',()=>assert.match(html,/href="dashboard-pbi\.css\?v=[A-Za-z0-9_-]+"/)],
  ['interactive dashboard dispatch',()=>assert.match(app,/PbiDashboard\.view\(\)/)],
  ['BI module defined',()=>assert.match(bi,/PbiDashboard/)],
  ['BI styles defined',()=>assert.match(css,/\.pbi-/)],
  ['BI script cached',()=>assert.ok(sw.includes("'./dashboard-pbi.js'"))],
  ['BI CSS cached',()=>assert.ok(sw.includes("'./dashboard-pbi.css'"))],
  ['visible logo references resolve',()=>{const refs=[...html.matchAll(/<img\b[^>]*\bsrc="([^"?]+)(?:\?[^\"]*)?"[^>]*>/g)].map(m=>m[1]);assert.ok(refs.length>0,'No image references found');for(const ref of refs){assert.ok(!ref.includes('..'),'Unsafe image path');assert.ok(fs.statSync(ref).size>0,`Missing or empty image: ${ref}`)}}],
  // This checks asset integrity only; approval of the final logo requires a visual comparison.
  ['logo accessibility label',()=>assert.match(html,/<img[^>]*alt="MI COMICTECA"/)],
];
let failed=0;
for(const [name,test] of checks){try{test();console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e.message)}}
if(failed)process.exitCode=1;

// Test the actual dashboard view, not just the selector labels.
(async()=>{
 const vm=require('node:vm');
 const rows=[{id:'1',publisher:'Owned Press',character:'Batman',universe:'DC',status:'In Collection',startYear:'1980'},{id:'2',publisher:'Wish Press',character:'Spider-Man',universe:'Marvel',status:'On Wish List',startYear:'2000'},{id:'3',publisher:'Unassigned Press',status:'',startYear:'2010'}];
 const ctx={window:{},document:{readyState:'loading',addEventListener(){}},allStore:async key=>key==='comics'?rows:[],ckey:x=>x.publisher,esc:x=>String(x??''),num:x=>Number(x)||0,money:x=>String(x),head:()=>'',console};
 vm.runInNewContext(bi,ctx);const api=ctx.window.PbiDashboard;
 const charts=html=>html.split('<section class="pbi-panel"><div class="pbi-title"><b>Evolución de compras')[0];
 let page=charts(await api.view());assert(page.includes('Owned Press'));assert(!page.includes('Wish Press'));assert(!page.includes('Unassigned Press'));
 api.setScope('wishlist');page=charts(await api.view());assert(page.includes('Wish Press'));assert(!page.includes('Owned Press'));assert(!page.includes('Unassigned Press'));
 await api.filter('publisher',encodeURIComponent('Wish Press'));page=await api.view();assert(page.includes('Ver todos los ejemplares (1)'));assert(page.includes('Spider-Man'));
 api.setScope('all');page=await api.view();assert(page.includes('Owned Press'));assert(page.includes('Wish Press'));assert(page.includes('Unassigned Press'));assert(!page.includes('DESGLOSE ·'));
 console.log('PASS: statistics scopes and wishlist drilldown');
})().catch(e=>{console.error(e);process.exitCode=1});
