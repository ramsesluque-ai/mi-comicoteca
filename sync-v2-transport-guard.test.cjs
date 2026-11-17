'use strict';
const assert=require('node:assert/strict');
const guard=require('./sync-v2-transport-guard.js');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const base={uid:a,sessionUid:a,dbName:'comicteca-user-'+a,localRows:[{id:'c1'}],remoteRows:[{id:'c1',user_id:a}],baselineRows:[{id:'c1'}],coverProofs:[]};
assert.equal(guard.validate(base).safe,true);
for(const change of [{sessionUid:b},{dbName:'comicteca-user-'+b},{remoteRows:[{id:'c1',user_id:b}]},{localRows:[{id:'c1'},{id:'c1'}]},{baselineRows:null},{coverProofs:[{uid:a,key:'a',localSha256:'a'.repeat(64),remoteSha256:'b'.repeat(64),getVerified:true}]},{coverProofs:[{uid:a,key:'a',localSha256:'a'.repeat(64),remoteSha256:'a'.repeat(64),getVerified:false}]}])assert.equal(guard.validate({...base,...change}).safe,false,JSON.stringify(change));
assert.equal(guard.validate({...base,coverProofs:[{uid:a,key:'x',localSha256:'a'.repeat(64),remoteSha256:'a'.repeat(64),getVerified:true}]}).safe,true);
const remote={id:'c1',user_id:a,local_id:'comics:c1',metadata:{kind:'comics',record:{id:'c1'}}};
assert.equal(guard.validate({...base,remoteRows:[remote]}).safe,true);
for(const altered of [
 {local_id:'comics:wrong'},
 {local_id:'wishlist:c1'},
 {metadata:{kind:'wishlist',record:{id:'c1'}}},
 {metadata:{kind:'comics',record:{id:'wrong'}}},
 {user_id:b}
]){
 const result=guard.validate({...base,remoteRows:[{...remote,...altered}]});
 assert.equal(result.safe,false,JSON.stringify(altered));
}
assert.equal(guard.validate({...base,uid:'11111111-1111-4111-8111-11111111111-',sessionUid:'11111111-1111-4111-8111-11111111111-',dbName:'comicteca-user-11111111-1111-4111-8111-11111111111-'}).safe,false);
console.log('PASS 16 fail-closed transport preflight scenarios; no production data accessed');
