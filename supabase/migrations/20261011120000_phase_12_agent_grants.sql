-- Phase 12: short-lived read grants for the agent's tool endpoints.
--
-- A grant names exactly one analysis. The app mints one per question through
-- the asker's own token, so the insert policy is what proves they may read it.
-- Only a hash of the token is stored; the token itself travels to the agent
-- service and back to the tool endpoints as the x-agent-grant request header.
-- Tool endpoints read with the publishable key, so the anon policies below are
-- the only thing deciding which rows they see. No key that reads every
-- analysis is involved anywhere.

create table public.agent_grants (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  analysis_id uuid not null,
  organization_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (analysis_id, organization_id)
    references public.analyses(id, organization_id) on delete cascade
);

create index agent_grants_analysis_organization_idx
  on public.agent_grants(analysis_id, organization_id);

alter table public.agent_grants enable row level security;
revoke all on table public.agent_grants from anon, authenticated;
grant insert on table public.agent_grants to authenticated;

-- Insert-only. Nobody selects grants back; the hash is matched inside
-- private.agent_grant_analysis() below.
create policy "Current organization can grant the agent one of its analyses"
  on public.agent_grants for insert
  to authenticated
  with check (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    and expires_at > now()
    and expires_at <= now() + interval '15 minutes'
    and exists (
      select 1 from public.analyses a
      where a.id = analysis_id and a.organization_id = agent_grants.organization_id
    )
  );

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon;

-- The analysis the current request's grant names, or null. Security definer so
-- anon can match a hash without being able to read the grants table.
create function private.agent_grant_analysis()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.analysis_id
  from public.agent_grants g
  where g.token_hash = encode(
      pg_catalog.sha256(convert_to(
        nullif(current_setting('request.headers', true), '')::json ->> 'x-agent-grant', 'UTF8')),
      'hex')
    and g.expires_at > now()
$$;

revoke all on function private.agent_grant_analysis() from public, anon, authenticated;
grant execute on function private.agent_grant_analysis() to anon;

grant select on table public.analyses, public.files, public.edges, public.routes, public.file_roles to anon;

create policy "Agent grant can read its analysis"
  on public.analyses for select
  to anon
  using (id = (select private.agent_grant_analysis()));

create policy "Agent grant can read its files"
  on public.files for select
  to anon
  using (analysis_id = (select private.agent_grant_analysis()));

create policy "Agent grant can read its edges"
  on public.edges for select
  to anon
  using (analysis_id = (select private.agent_grant_analysis()));

create policy "Agent grant can read its routes"
  on public.routes for select
  to anon
  using (analysis_id = (select private.agent_grant_analysis()));

create policy "Agent grant can read its file roles"
  on public.file_roles for select
  to anon
  using (analysis_id = (select private.agent_grant_analysis()));
