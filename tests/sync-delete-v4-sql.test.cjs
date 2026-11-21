'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('sql/mc_sync_delete_v4_cas_tombstone.sql','utf8');
test('tombstone is opt-in, authenticated and scoped to owner',()=>{
 assert.match(sql,/REVIEW ONLY: NOT DEPLOYED/);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/auth\.uid\(\)/i);
 assert.match(sql,/where user_id=v_uid and local_id=p_local_id/i);
 assert.match(sql,/grant execute on function public\.mc_sync_delete_v4\(text,timestamptz\) to authenticated/i);
});
test('tombstone requires CAS and does not hard-delete records or covers',()=>{
 assert.match(sql,/updated_at=p_expected_updated_at/i);
 assert.match(sql,/coalesce\(metadata->>'deleted','false'\)<>'true'/i);
 assert.match(sql,/jsonb_set\(jsonb_set/i);
 assert.match(sql,/updated_at=greatest\(clock_timestamp\(\),updated_at \+ interval '1 microsecond'\)/i);
 assert.doesNotMatch(sql,/\bdelete\s+from\b/i);
 assert.doesNotMatch(sql,/\btruncate\b/i);
 assert.doesNotMatch(sql,/storage\.objects/i);
});
test('conflict does not report a successful deletion',()=>{
 assert.match(sql,/if v_row is null then return jsonb_build_object\('state','conflict'\)/i);
 assert.match(sql,/return jsonb_build_object\('state','deleted'/i);
});

test('trigger-overridden timestamp must fail closed and roll back',()=>{
 assert.match(sql,/v_row\.updated_at <= p_expected_updated_at/);
 assert.match(sql,/raise exception 'CAS version did not advance/);
 assert.match(sql,/errcode='40001'/);
 assert.match(sql,/trg_user_comics_updated_at/);
});
