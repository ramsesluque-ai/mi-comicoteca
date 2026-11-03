-- MI COMICOTECA · Postflight de carga del Maestro
-- SOLO LECTURA. Ejecutar después de importar todos los lotes.
-- Contrato canónico validado por Export Master for Supabase (2026-11-03):
-- 5.792 identidades de serie y 160.472 cómics.

select 'master_series' as object_name, count(*) as row_count,
       (count(*) = 5792) as expected_count
from public.master_series
union all
select 'master_comics', count(*), (count(*) = 160472)
from public.master_comics
union all
select 'user_comics', count(*), true
from public.user_comics
union all
select 'cover_history', count(*), true
from public.cover_history;

-- Integridad referencial lógica: ningún cómic del Maestro debe quedar huérfano.
select count(*) as orphan_master_comics
from public.master_comics c
left join public.master_series s on s.id = c.series_id
where s.id is null;

-- Las identidades canónicas de serie deben seguir siendo únicas.
select publisher,title,volume,stage,start_year,count(*) as duplicates
from public.master_series
group by publisher,title,volume,stage,start_year
having count(*) > 1;

-- No tratamos (series_id, issue_number) como identidad única: existen variantes
-- editoriales legítimas con el mismo número. Se auditan, no se eliminan.
select count(*) as repeated_issue_number_groups
from (
  select series_id,issue_number
  from public.master_comics
  where issue_number is not null and btrim(issue_number) <> ''
  group by series_id,issue_number
  having count(*) > 1
) d;

-- La carga del Maestro nunca debe requerir escrituras en user_comics ni cover_history.
