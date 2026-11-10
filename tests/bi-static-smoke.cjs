'use strict';
// COMICTECA: static smoke checks; browser rendering and backend tests are separate.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const html=read('index.html'), app=read('app5.js'), bi=read('dashboard-pbi.js'), css=read('dashboard-pbi.css'), sw=read('sw.js');
const checks=[
  ['dashboard navigation',()=>assert.match(html,/data-v="dashboard"/)],
  ['BI JavaScript linked',()=>assert.match(html,/src="dashboard-pbi\.js\?v=\d+"/)],
  ['BI CSS linked',()=>assert.match(html,/href="dashboard-pbi\.css\?v=\d+"/)],
  ['interactive dashboard dispatch',()=>assert.match(app,/PbiDashboard\.view\(\)/)],
  ['BI module defined',()=>assert.match(bi,/PbiDashboard/)],
  ['BI styles defined',()=>assert.match(css,/\.pbi-/)],
  ['BI script cached',()=>assert.ok(sw.includes("'./dashboard-pbi.js'"))],
  ['BI CSS cached',()=>assert.ok(sw.includes("'./dashboard-pbi.css'"))],
  ['visible logo references resolve',()=>{const refs=[...html.matchAll(/<img\b[^>]*\bsrc="([^"?]+)(?:\?[^\"]*)?"[^>]*>/g)].map(m=>m[1]);assert.ok(refs.length>0,'No image references found');for(const ref of refs){assert.ok(!ref.includes('..'),'Unsafe image path');assert.ok(fs.statSync(ref).size>0,`Missing or empty image: ${ref}`)}}],
  // This checks asset integrity only; approval of the final logo requires a visual comparison.
  ['logo accessibility label',()=>assert.match(html,/<img[^>]*alt="COMICTECA"/)],
];
let failed=0;
for(const [name,test] of checks){try{test();console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e.message)}}
if(failed)process.exitCode=1;
