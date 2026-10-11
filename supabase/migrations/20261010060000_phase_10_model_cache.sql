-- Phase 10: model output cache, model-assigned roles, and the labelling stage.

-- Keyed on what was explained, not on a file row: a re-run deletes and
-- re-inserts files, and an unchanged file should still hit. The model is part
-- of the key and stored beside it, so re-pinning one invalidates only its rows.
-- No foreign key on organization_id: Clerk owns organizations and the local
-- mirror was dropped in phase 02, same as every other tenant table.
create table public.model_cache (
  organization_id text not null,
  cache_key text not null,
  task text not null,
  model text not null,
  output jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, cache_key)
);

alter table public.model_cache enable row level security;
revoke all on table public.model_cache from anon, authenticated;
grant select on table public.model_cache to authenticated;

create policy "Current organization can read model cache"
  on public.model_cache for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

-- One model-assigned role per file, and which model said so.
alter table public.file_roles
  add column model text not null,
  add constraint file_roles_file_id_key unique (file_id),
  add constraint file_roles_role_check
    check (role in ('service', 'repository', 'model', 'utility', 'config', 'component', 'hook'));

alter table public.analyses
  add column labelling_error text;

alter table public.analyses drop constraint analyses_stage_check;
alter table public.analyses add constraint analyses_stage_check
  check (stage in ('queued', 'fetching', 'selecting', 'parsing', 'storing', 'labelling', 'complete', 'failed'));
