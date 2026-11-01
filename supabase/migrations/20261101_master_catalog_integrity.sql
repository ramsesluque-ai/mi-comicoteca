-- Production integrity for shared Master catalog.
-- Series identity: Editorial + Cabecera + Volumen/Etapa + Año inicio.
-- Existing unique constraint on master_series is retained.

-- Prevent duplicate issue rows within the same master series when issue_number is known.
create unique index if not exists master_comics_series_issue_unique
on public.master_comics (series_id, issue_number)
where issue_number is not null and btrim(issue_number) <> '';

-- Read performance for Master filters.
create index if not exists idx_master_series_publisher_title
on public.master_series (publisher, title);

create index if not exists idx_master_comics_isbn
on public.master_comics (isbn)
where isbn is not null and btrim(isbn) <> '';
