-- MI COMICOTECA | Esquema comercial inicial para Supabase (NO aplicado en producción)
-- Revisión manual requerida antes de ejecutar. No incluye credenciales ni pagos reales.
-- Identidad: auth.users; cada registro privado pertenece a un único usuario.
create extension if not exists pgcrypto;

create table if not exists public.mc_master_issues (
 id uuid primary key default gen_random_uuid(),
 publisher text not null,
 catalog_header text not null,
 volume text not null default '',
 stage text not null default '',
 start_year integer,
 issue_number text not null default '',
 title text not null default '',
 isbn text,
 cover_source_url text,
 metadata jsonb not null default '{}'::jsonb,
 imported_at timestamptz not null default now()
);
create index if not exists mc_master_group_idx on public.mc_master_issues (publisher,catalog_header,volume,stage,start_year);
create index if not exists mc_master_isbn_idx on public.mc_master_issues (isbn) where isbn is not null;
alter table public.mc_master_issues enable row level security;
drop policy if exists mc_master_read on public.mc_master_issues;
create policy mc_master_read on public.mc_master_issues for select to authenticated using (true);
-- Las escrituras del Maestro se realizan solo mediante un proceso de importación privilegiado.

create table if not exists public.mc_user_comics (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 master_issue_id uuid references public.mc_master_issues(id) on delete set null,
 publisher text not null default '',
 catalog_header text not null default '',
 volume text not null default '',
 stage text not null default '',
 start_year integer,
 issue_number text not null default '',
 title text not null default '',
 status text not null default 'In Collection'
   check (status in ('In Collection','On Wish List','For Sale','Sold')),
 condition text,
 notes text,
 cover_storage_path text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists mc_user_comics_user_idx on public.mc_user_comics(user_id);
create index if not exists mc_user_comics_group_idx on public.mc_user_comics(user_id,publisher,catalog_header,volume,stage,start_year);
alter table public.mc_user_comics enable row level security;
drop policy if exists mc_comics_select on public.mc_user_comics;
drop policy if exists mc_comics_insert on public.mc_user_comics;
drop policy if exists mc_comics_update on public.mc_user_comics;
drop policy if exists mc_comics_delete on public.mc_user_comics;
create policy mc_comics_select on public.mc_user_comics for select to authenticated using (user_id = (select auth.uid()));
create policy mc_comics_insert on public.mc_user_comics for insert to authenticated with check (user_id = (select auth.uid()));
create policy mc_comics_update on public.mc_user_comics for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy mc_comics_delete on public.mc_user_comics for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.mc_subscriptions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 stripe_customer_id text unique,
 stripe_subscription_id text unique,
 status text not null default 'inactive',
 current_period_end timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.mc_subscriptions enable row level security;
drop policy if exists mc_subscriptions_select on public.mc_subscriptions;
create policy mc_subscriptions_select on public.mc_subscriptions for select to authenticated using (user_id = (select auth.uid()));
-- No crear políticas INSERT/UPDATE/DELETE para authenticated: solo webhook Stripe verificado en backend.

-- Bucket privado mc-covers: crear desde Storage y definir políticas por primer segmento
-- de ruta = auth.uid()::text. No usar URLs públicas ni credenciales GitHub en navegador.
-- Pruebas obligatorias: usuario A no lee/escribe registros ni portadas de B;
-- sin sesión no accede; webhook con firma inválida no modifica suscripciones;
-- cancelación al final del periodo conserva acceso hasta current_period_end.
