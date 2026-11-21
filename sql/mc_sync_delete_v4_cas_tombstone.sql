-- REVIEW ONLY: NOT DEPLOYED. V4 CAS tombstone, no hard deletes.
create or replace function public.mc_sync_delete_v4(
 p_local_id text, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_uid uuid := (select auth.uid()); v_row record;
begin
 if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_local_id is null or p_local_id !~ '^comics:[A-Za-z0-9_.:-]{1,180}$'
    or p_expected_updated_at is null then
   raise exception 'Valid comic ID and baseline version required' using errcode='22023';
 end if;
 update public.user_comics
 set metadata=jsonb_set(jsonb_set(coalesce(metadata,'{}'::jsonb),
    '{deleted}','true'::jsonb,true),'{deletedAt}',to_jsonb(now()),true),
    updated_at=greatest(clock_timestamp(),updated_at + interval '1 microsecond')
 where user_id=v_uid and local_id=p_local_id
   and updated_at=p_expected_updated_at
   and metadata->>'kind'='comics'
   and coalesce(metadata->>'deleted','false')<>'true'
 returning local_id,updated_at into v_row;
 if v_row is null then return jsonb_build_object('state','conflict'); end if;
 -- A BEFORE UPDATE trigger currently assigns now() to updated_at, potentially
 -- overriding our monotonic expression. Fail closed and ROLLBACK the UPDATE
 -- if the persisted version did not advance. Never ACK an ambiguous CAS.
 if v_row.updated_at <= p_expected_updated_at then
   raise exception 'CAS version did not advance; check trg_user_comics_updated_at' using errcode='40001';
 end if;
 return jsonb_build_object('state','deleted','local_id',v_row.local_id,
   'updated_at',v_row.updated_at);
end;
$function$;
revoke all on function public.mc_sync_delete_v4(text,timestamptz) from public,anon;
grant execute on function public.mc_sync_delete_v4(text,timestamptz) to authenticated;
-- Verified 2026-11-21: trg_user_comics_updated_at invokes set_updated_at(),
-- which overwrites updated_at with now(). This guard prevents false ACK but
-- production installation remains BLOCKED until the trigger/version strategy
-- is corrected and tested with two isolated authenticated accounts.
-- RLS owner update policy; 2 real isolated test UIDs.
-- Status is intentionally unchanged: no assumption about status CHECK constraints.
-- Explicit monotonic updated_at ensures CAS changes even without a timestamp trigger.
-- Retains original record/cover; never deletes rows or storage objects.
