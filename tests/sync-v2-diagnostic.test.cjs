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
