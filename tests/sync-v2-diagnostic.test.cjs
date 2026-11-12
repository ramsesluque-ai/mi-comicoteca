'use strict';
// Read-only regression guard: diagnostic must use stable keyset pagination.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../sync-v2-diagnostic.js'),'utf8');
assert.match(source,/order=local_id\.asc&limit=500/);
assert.match(source,/local_id=gt\./);
assert.match(source,/encodeURIComponent\(lastKey\)/);
assert.match(source,/seenKeys\.has\(row\.local_id\)/);
assert.match(source,/row\.local_id<=lastKey/);
assert.doesNotMatch(source,/&offset=/);
assert.doesNotMatch(source,/\b(?:putStore|delStore)\s*\(/);
assert.doesNotMatch(source,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
console.log('PASS: read-only diagnostic keyset pagination guard');

const receive=fs.readFileSync(require('node:path').join(__dirname,'../sync-v2-owner-receive.js'),'utf8');
assert.match(receive,/order=local_id\\.asc/);
assert.match(receive,/local_id=gt\\./);
assert.match(receive,/encodeURIComponent\\(lastKey\\)/);
assert.match(receive,/seenRemoteIds\\.has\\(row\\.local_id\\)/);
assert.match(receive,/row\\.local_id<=lastKey/);
assert.match(receive,/row\\.local_id!=='comics:'\\+String\\(r\\.id\\)/);
assert.doesNotMatch(receive,/&offset=/);
console.log('PASS: owner receive stable keyset and remote identity guards');
