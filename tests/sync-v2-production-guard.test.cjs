'use strict';
// Production safety guard: button remains diagnostic-only until isolated E2E/RLS approval.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const button=fs.readFileSync('manual-sync-v2-button.js','utf8');
const legacy=fs.readFileSync('cloud-collection-sync.js','utf8');
const upload=fs.readFileSync('sync-v2-owner-upload.js','utf8');
const receive=fs.readFileSync('sync-v2-owner-receive.js','utf8');
assert.match(button,/MCSyncV2ReadPlan\.compare/,'Manual button must retain read-only compare');
assert.match(button,/MCSyncV2CoverInventory\.compare/,'Manual button must retain cover inventory');
for(const forbidden of [/\.copyIfAbsent\s*\(/,/\.putStore\s*\(/,/\bputStore\s*\(/,/\bfetch\s*\([^)]*method\s*:\s*['"](?:POST|PATCH|DELETE|PUT)/]){
 assert(!forbidden.test(button),'Manual button unexpectedly gained a write path: '+forbidden);
}
assert.match(legacy,/paused|disabled|desactivad/i,'Legacy V1 must remain disabled');
assert.match(upload,/get\('syncv2'\)!=='subida'/,'Owner upload must require explicit opt-in');
assert.match(receive,/get\('syncv2'\)!=='recepcion'/,'Owner receive must require explicit opt-in');
console.log('PASS manual sync V2 is read-only; V1 paused; owner migration paths gated');
