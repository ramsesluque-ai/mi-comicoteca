'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'master-cover-contributions.js'),'utf8');
const css=fs.readFileSync(path.join(root,'master-cover-contributions.css'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('cover contribution script parses without JavaScript errors',()=>{
 assert.doesNotThrow(()=>new Function(js));
});
test('attachment is open and placed before the lookup, including remote URL',()=>{
 assert.ok(js.includes('<details class="mc-contrib-upload" open>'));
 assert.ok(js.includes("contribBody.insertBefore(contribUpload,contribSearch);"));
 assert.ok(js.includes("contribLookupSection.append(contribSearch,contribResults,searchExtra);"));
 assert.ok(js.includes("contribUpload.open=true;"));
 assert.ok(js.includes("contribFile.addEventListener('change'"));
});
test('existing upload, exact-issue lookup, URL choice and rights checks remain wired',()=>{
 for(const id of ['mcContribFile','mcContribSend','mcContribLookup','mcContribLookupResults','mcContribRemoteUrl','mcContribUseUrl','mcContribSelectedPreview','mcContribRights','mcContribNote']){
  assert.ok(js.includes(id),id);
 }
 assert.match(js,/if\(!ownerSession&&\(!rights\|\|note\.length<20\)\)/);
 assert.ok(js.includes("/storage/v1/object/master-contributions/"));
 assert.ok(js.includes('crypto.randomUUID()'));
});
test('dialog design is styled through the native stylesheet, not obsolete injected CSS',()=>{
 assert.ok(!js.includes('mc-master-upload-polish'));
 assert.ok(css.includes('.mc-contrib-modal .mc-contrib-lookup-section'));
 assert.ok(css.includes('.mc-contrib-modal .mc-contrib-upload'));
 assert.ok(css.includes('.mc-contrib-formgrid label[hidden]'));
 assert.ok(css.includes('input[type=file]::file-selector-button'));
 assert.ok(css.includes('@media(max-width:620px)'));
});
test('published entrypoint cache-busts both form assets',()=>{
 assert.ok(html.includes('master-cover-contributions.css?v=20261116-attachment-first'));
 assert.ok(html.includes('master-cover-contributions.js?v=20261116-attachment-first'));
});
