-- MI COMICTECA Sync V2: read-only preflight for real two-account E2E.
-- Run in Supabase SQL editor; never changes production data.
-- An administrative SQL result is NOT a substitute for authenticated RLS tests.
select
  (select count(*) from public.user_comics) as owner_rows_snapshot,
  (select count(distinct user_id) from public.user_comics) as owners_with_rows,
  (select count(*) from storage.objects where bucket_id='user-covers') as private_cover_objects,
  (select relrowsecurity from pg_class where oid='public.user_comics'::regclass) as comics_rls_enabled,
  (select public from storage.buckets where id='user-covers') as covers_bucket_public;
-- A newly registered test user must have a profile and an active membership,
-- or the current policies deliberately deny SELECT/INSERT/UPDATE on user_comics
-- and private covers. Do NOT bypass membership checks or grant admin privileges.
select
  policyname, cmd, roles,
  (qual ilike '%auth.uid()%') as checks_authenticated_uid,
  (coalesce(qual,'') ilike '%membership_active%' or
   coalesce(with_check,'') ilike '%membership_active%') as checks_membership
from pg_policies
where (schemaname='public' and tablename='user_comics')
   or (schemaname='storage' and tablename='objects'
       and policyname like 'users_%_own_covers')
order by schemaname, tablename, policyname;
-- Required next step: authenticated JWT requests as each test identity,
-- checking own/other-user reads and writes and private Storage GET/POST.
-- No service-role or SQL-editor session can prove the RLS isolation.
