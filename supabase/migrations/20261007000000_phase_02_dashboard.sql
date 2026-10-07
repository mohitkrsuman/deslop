-- Phase 02: the analysis schema and database-owned tenant isolation.
-- Clerk owns the real organizations. This small mirror gives Postgres a
-- foreign-key target so deleting an organization can cascade its data.

create table public.organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null,
  repository_url text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  name text not null,
  status text not null check (status in ('queued', 'analyzing', 'complete', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  language text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (analysis_id, organization_id)
    references public.analyses(id, organization_id) on delete cascade,
  unique (analysis_id, path)
);

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  kind text not null default 'import',
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (analysis_id, organization_id)
    references public.analyses(id, organization_id) on delete cascade,
  foreign key (source_file_id, organization_id)
    references public.files(id, organization_id) on delete cascade,
  foreign key (target_file_id, organization_id)
    references public.files(id, organization_id) on delete cascade
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  method text not null,
  path text not null,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (analysis_id, organization_id)
    references public.analyses(id, organization_id) on delete cascade,
  foreign key (file_id, organization_id)
    references public.files(id, organization_id) on delete cascade
);

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (analysis_id, organization_id)
    references public.analyses(id, organization_id) on delete cascade,
  foreign key (file_id, organization_id)
    references public.files(id, organization_id) on delete cascade
);

create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  role text not null,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (analysis_id, organization_id)
    references public.analyses(id, organization_id) on delete cascade,
  foreign key (file_id, organization_id)
    references public.files(id, organization_id) on delete cascade
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid,
  title text not null,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (analysis_id, organization_id)
    references public.analyses(id, organization_id) on delete cascade,
  foreign key (file_id, organization_id)
    references public.files(id, organization_id) on delete cascade
);

create index projects_organization_id_idx on public.projects(organization_id);
create index analyses_organization_created_at_idx
  on public.analyses(organization_id, created_at desc);
create index files_organization_id_idx on public.files(organization_id);
create index edges_organization_id_idx on public.edges(organization_id);
create index routes_organization_id_idx on public.routes(organization_id);
create index explanations_organization_id_idx on public.explanations(organization_id);
create index file_roles_organization_id_idx on public.file_roles(organization_id);
create index insights_organization_id_idx on public.insights(organization_id);

-- Client roles can only read rows from the current Clerk organization. Writes
-- belong to the analysis worker and will use a server-side role later.
revoke all on table
  public.organizations,
  public.projects,
  public.analyses,
  public.files,
  public.edges,
  public.routes,
  public.explanations,
  public.file_roles,
  public.insights
from anon, authenticated;

grant select on table
  public.organizations,
  public.projects,
  public.analyses,
  public.files,
  public.edges,
  public.routes,
  public.explanations,
  public.file_roles,
  public.insights
to authenticated;

alter table public.organizations enable row level security;
alter table public.projects enable row level security;
alter table public.analyses enable row level security;
alter table public.files enable row level security;
alter table public.edges enable row level security;
alter table public.routes enable row level security;
alter table public.explanations enable row level security;
alter table public.file_roles enable row level security;
alter table public.insights enable row level security;

create policy "Current organization can read itself"
  on public.organizations for select
  to authenticated
  using (id = (select auth.jwt() ->> 'org_id'));

create policy "Current organization can read projects"
  on public.projects for select
  to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Current organization can read analyses"
  on public.analyses for select
  to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Current organization can read files"
  on public.files for select
  to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Current organization can read edges"
  on public.edges for select
  to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Current organization can read routes"
  on public.routes for select
  to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Current organization can read explanations"
  on public.explanations for select
  to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Current organization can read file roles"
  on public.file_roles for select
  to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Current organization can read insights"
  on public.insights for select
  to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));
