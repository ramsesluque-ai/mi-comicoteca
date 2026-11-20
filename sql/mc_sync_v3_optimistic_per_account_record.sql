-- MI COMICTECA: applied to Supabase production on 2026-11-20.
-- RLS remains active; no data migration or existing comic writes.
CREATE OR REPLACE FUNCTION public.mc_sync_comic_v3(p_local_id text, p_record jsonb, p_mode text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_comic_id text;
  v_status text;
  v_existing_cover text;
  v_new_cover text;
  v_row record;
begin
  if v_uid is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_local_id is null or p_local_id !~ '^comics:[A-Za-z0-9_.:-]{1,180}$' then
    raise exception 'Invalid stable comic ID' using errcode = '22023';
  end if;
  v_comic_id := substring(p_local_id from 8);
  if p_record is null or jsonb_typeof(p_record) <> 'object'
    or p_record->>'id' is distinct from v_comic_id
    or pg_catalog.pg_column_size(p_record) > 1048576 then
    raise exception 'Invalid or mismatched comic payload' using errcode = '22023';
  end if;
  if coalesce(p_record->>'deleted','false') = 'true' then
    raise exception 'Deletion needs a separate verified tombstone workflow' using errcode = '22023';
  end if;
  v_status := case lower(coalesce(p_record->>'status',''))
    when 'in collection' then 'owned'
    when 'owned' then 'owned'
    when 'on wish list' then 'wishlist'
    when 'wishlist' then 'wishlist'
    when 'sold' then 'sold'
    when 'for sale' then 'for_sale'
    when 'for_sale' then 'for_sale'
    else 'missing'
  end;
  v_new_cover := nullif(p_record->>'coverKey','');
  if v_new_cover is not null then
    if v_new_cover !~ '^[A-Za-z0-9_.-]{1,180}$' then
      raise exception 'Invalid private cover identifier' using errcode = '22023';
    end if;
  end if;
  if p_mode = 'insert' then
    if p_expected_updated_at is not null then
      raise exception 'Insert cannot specify an expected version' using errcode = '22023';
    end if;
    if v_new_cover is not null and not exists (
      select 1 from storage.objects
      where bucket_id='user-covers' and name=v_uid::text||'/'||v_new_cover
    ) then
      return jsonb_build_object('state','missing-cover');
    end if;
    insert into public.user_comics (user_id,local_id,status,custom_title,metadata)
      values (v_uid,p_local_id,v_status,left(coalesce(p_record->>'title',p_record->>'catalogHeader',p_record->>'series',''),500),
              jsonb_build_object('kind','comics','record',p_record,'source','device-v3','comicteca_sync_v',3))
    on conflict (user_id,local_id) do nothing
    returning updated_at,local_id into v_row;
  elsif p_mode = 'update' then
    if p_expected_updated_at is null then
      raise exception 'Update requires the server version' using errcode = '22023';
    end if;
    select metadata->'record'->>'coverKey' into v_existing_cover
      from public.user_comics
      where user_id=v_uid and local_id=p_local_id and updated_at=p_expected_updated_at;
    if v_existing_cover is distinct from v_new_cover and v_new_cover is not null
       and not exists (
        select 1 from storage.objects
        where bucket_id='user-covers' and name=v_uid::text||'/'||v_new_cover
       ) then
      return jsonb_build_object('state','missing-cover');
    end if;
    update public.user_comics
      set metadata=jsonb_set(metadata,'{record}',p_record,true),
          status=v_status,
          custom_title=left(coalesce(p_record->>'title',p_record->>'catalogHeader',p_record->>'series',''),500)
      where user_id=v_uid and local_id=p_local_id
        and updated_at=p_expected_updated_at
        and metadata->>'kind'='comics'
        and coalesce(metadata->>'deleted','false')<>'true'
      returning updated_at,local_id into v_row;
  else
    raise exception 'Unsupported sync mode' using errcode = '22023';
  end if;
  if v_row is null then
    return jsonb_build_object('state','conflict');
  end if;
  return jsonb_build_object('state','saved','local_id',v_row.local_id,'updated_at',v_row.updated_at);
end;
$function$

revoke all on function public.mc_sync_comic_v3(text,jsonb,text,timestamptz) from public, anon;
grant execute on function public.mc_sync_comic_v3(text,jsonb,text,timestamptz) to authenticated;
