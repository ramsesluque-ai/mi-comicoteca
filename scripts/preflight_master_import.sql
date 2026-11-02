-- MI COMICOTECA · Preflight de carga del Maestro
-- SOLO LECTURA. Ejecutar antes de importar cualquier lote.

select 'master_series' as object_name, count(*) as row_count from public.master_series
union all
select 'master_comics', count(*) from public.master_comics
union all
select 'user_comics', count(*) from public.user_comics
union all
select 'cover_history', count(*) from public.cover_history;

-- Confirma columnas esperadas por scripts/export_master_supabase.py.
select table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in ('master_series','master_comics')
order by table_name,ordinal_position;

-- Detecta duplicados preexistentes antes de una carga idempotente.
select publisher,title,volume,stage,start_year,count(*) as duplicates
from public.master_series
group by publisher,title,volume,stage,start_year
having count(*) > 1;

select series_id,issue_number,count(*) as duplicates
from public.master_comics
where issue_number is not null and btrim(issue_number) <> ''
group by series_id,issue_number
having count(*) > 1;

-- Esta comprobación no modifica user_comics ni cover_history.
