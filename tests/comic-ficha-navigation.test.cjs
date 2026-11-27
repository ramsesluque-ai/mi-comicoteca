'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','comic-ficha-navigation.js'),'utf8');
const rows=[
 {id:'1',issueNr:'1',edition:'a',status:'In Collection'},
 {id:'2',issueNr:'2',edition:'legacy-a',status:'On Wish List'},
 {id:'3',issueNr:'3',edition:'a',status:''},
 {id:'10',issueNr:'10',edition:'a',status:'In Collection'},
 {id:'other',issueNr:'2',edition:'b',status:'In Collection'}
];
function setup(view){
 let foot,opened=[];
 const make=()=>({style:{},children:[],appendChild(x){this.children.push(x)},prepend(x){this.children.unshift(x)}});
 const modal={querySelectorAll:()=>[]};
 const window={editComic:async id=>{opened.push(id);foot=make()},mcCollectionIdentityV50:{
  currentStatic:async()=>({}),resolvedKey:x=>x.edition==='legacy-a'?'a':x.edition
 }};
 const document={querySelector:q=>q==='#modal .modalfoot'?foot:q==='#modal'?modal:null,createElement:make};
 vm.runInNewContext(source,{window,document,current:view,ckey:x=>x.edition,allStore:async()=>rows,getStore:async(_,id)=>rows.find(x=>x.id===id),console});
 return {window,opened,buttons:()=>foot.children[0].children};
}
test('Colecciones traverses owned, wishlist, unclassified, and legacy identity in numeric order, never another edition',async()=>{
 const x=setup('series');await x.window.editComic('1');
 assert.equal(x.buttons()[0].disabled,true);
 await x.buttons()[1].onclick();await x.buttons()[1].onclick();await x.buttons()[1].onclick();
 assert.deepEqual(x.opened,['1','2','3','10']);assert.equal(x.buttons()[1].disabled,true);
 await x.buttons()[0].onclick();assert.equal(x.opened.at(-1),'3');
});
test('status-specific catalog outside Collections retains its original behavior',async()=>{
 const x=setup('catalog');await x.window.editComic('1');await x.buttons()[1].onclick();
 assert.deepEqual(x.opened,['1','10']);assert.equal(x.buttons()[1].disabled,true);
});
