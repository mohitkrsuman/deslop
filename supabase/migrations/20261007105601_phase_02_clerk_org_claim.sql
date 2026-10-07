-- Clerk's native Supabase integration can expose the active organization ID
-- as o.id, while compatible tokens may expose it as top-level org_id.
-- org_name is display data and must not be used as the tenant key.

drop policy if exists "Current organization can read projects" on public.projects;
drop policy if exists "Current organization can read analyses" on public.analyses;
drop policy if exists "Current organization can read files" on public.files;
drop policy if exists "Current organization can read edges" on public.edges;
drop policy if exists "Current organization can read routes" on public.routes;
drop policy if exists "Current organization can read explanations" on public.explanations;
drop policy if exists "Current organization can read file roles" on public.file_roles;
drop policy if exists "Current organization can read insights" on public.insights;

create policy "Current organization can read projects"
  on public.projects for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "Current organization can read analyses"
  on public.analyses for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "Current organization can read files"
  on public.files for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "Current organization can read edges"
  on public.edges for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "Current organization can read routes"
  on public.routes for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "Current organization can read explanations"
  on public.explanations for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "Current organization can read file roles"
  on public.file_roles for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "Current organization can read insights"
  on public.insights for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));
