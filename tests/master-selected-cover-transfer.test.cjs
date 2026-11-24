'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'../master-static.js'),'utf8');
const start=src.indexOf('addFromMaster=async function(id,status)');
const end=src.indexOf('\n\n',start);
const transfer=src.slice(start,end);
test('both destinations preserve the exact displayed cover, not a duplicate source row',async()=>{
 const publicUrl='https://example.test/86.jpg',otherUrl='https://example.test/wrong.jpg';
 for(const status of ['In Collection','On Wish List']){
  const selected={id:'same',issueNr:'86',title:'Batman',coverUrl:publicUrl,coverKey:'foreign-key'};
  const raw={...selected,coverUrl:otherUrl};
  const records=[],attachments=[],notices=[];
  const window={mcSharedCovers:async()=>({}),mcMasterCoverKey:()=>'',CoverVault:{attach:async(c,url)=>{attachments.push(url);throw Error('offline')}}};
  const MCMasterUI={activeDisplayedRows:[selected],activeIssueRows:[raw],collectionKey:'batman'};
  const add=new Function('MCMasterUI','window','mcMasterEnrichRows','cleanComic','uuid','putStore','CoverVault','toast','openMasterCollection','console','return '+transfer)(MCMasterUI,window,async()=>[raw],x=>x,()=> 'personal-id',async(_,c)=>records.push(c),window.CoverVault,x=>notices.push(x),async()=>{},{warn(){}});
  await add('same',status);
  assert.equal(records[0].coverUrl,publicUrl);
  assert.equal(records[0].coverKey,'');
  assert.equal(records[0].status,status);
  assert.equal(attachments[0],publicUrl);
  assert.ok(notices[0].includes('NO se guardó la portada'));
 }
});
