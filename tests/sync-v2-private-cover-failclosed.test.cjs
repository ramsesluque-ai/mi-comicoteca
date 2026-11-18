'use strict';
/* Fail-closed private cover bridge tests; fake auth/cache only, no owner writes. */
const assert=require('node:assert/strict');
const bridge=require('../sync-v2-cover-cache-bridge.js');
const integrity=require('../sync-v2-cover-integrity.js');
const uid='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const session={user:{id:uid},access_token:'fake-token'};
const cfg={url:'https://fake-auth.test',publishableKey:'fake-public'};
let calls=0, writes=0;
const transport={
 verifiedCopyIfAbsent(){calls++;throw Error('unexpected upload')},
 verifiedReadVerified(){calls++;throw Error('unexpected download')}
};
const cacheStorage={open:async()=>({
 match:async()=>new Response(new Blob(['corrupted'],{type:'image/png'})),
 put:async()=>{writes++}
})};
const good=new Blob(['correct bytes'],{type:'image/png'});
(async()=>{
 const expectedSha256=await integrity.sha256(good);
 const base={session,cfg,key:'cover-1',expectedSha256,cacheStorage,integrity,transport};
 const mismatch=async()=>({ok:true,status:200,json:async()=>({id:other})});
 await assert.rejects(bridge.upload({...base,fetchImpl:mismatch}),/Identidad autenticada distinta/);
 await assert.rejects(bridge.download({...base,fetchImpl:mismatch}),/Identidad autenticada distinta/);
 await assert.rejects(bridge.installIfAbsent({...base,blob:good,fetchImpl:mismatch}),/Identidad autenticada distinta/);
 const authenticated=async()=>({ok:true,status:200,json:async()=>({id:uid})});
 await assert.rejects(bridge.upload({...base,fetchImpl:authenticated}),/SHA-256 local distinto/);
 await assert.rejects(bridge.installIfAbsent({...base,blob:good,fetchImpl:authenticated}),/Conflicto de portada local/);
 assert.equal(calls,0,'No Storage transport may run after failed auth or cache integrity');
 assert.equal(writes,0,'Existing cache bytes must never be overwritten');
 console.log('PASS private cover auth mismatch and corrupted cache fail closed');
})().catch(e=>{console.error(e);process.exitCode=1});
