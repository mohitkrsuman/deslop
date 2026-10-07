-- Keep auth.jwt() init-plan friendly and index the composite foreign keys
-- used to keep related rows inside the same organization.

drop policy if exists "Current organization can read itself" on public.organizations;
drop policy if exists "Current organization can read projects" on public.projects;
drop policy if exists "Current organization can read analyses" on public.analyses;
drop policy if exists "Current organization can read files" on public.files;
drop policy if exists "Current organization can read edges" on public.edges;
drop policy if exists "Current organization can read routes" on public.routes;
drop policy if exists "Current organization can read explanations" on public.explanations;
drop policy if exists "Current organization can read file roles" on public.file_roles;
drop policy if exists "Current organization can read insights" on public.insights;

create policy "Current organization can read itself"
  on public.organizations for select
  to authenticated
  using (id = ((select auth.jwt()) ->> 'org_id'));

create policy "Current organization can read projects"
  on public.projects for select
  to authenticated
  using (organization_id = ((select auth.jwt()) ->> 'org_id'));

create policy "Current organization can read analyses"
  on public.analyses for select
  to authenticated
  using (organization_id = ((select auth.jwt()) ->> 'org_id'));

create policy "Current organization can read files"
  on public.files for select
  to authenticated
  using (organization_id = ((select auth.jwt()) ->> 'org_id'));

create policy "Current organization can read edges"
  on public.edges for select
  to authenticated
  using (organization_id = ((select auth.jwt()) ->> 'org_id'));

create policy "Current organization can read routes"
  on public.routes for select
  to authenticated
  using (organization_id = ((select auth.jwt()) ->> 'org_id'));

create policy "Current organization can read explanations"
  on public.explanations for select
  to authenticated
  using (organization_id = ((select auth.jwt()) ->> 'org_id'));

create policy "Current organization can read file roles"
  on public.file_roles for select
  to authenticated
  using (organization_id = ((select auth.jwt()) ->> 'org_id'));

create policy "Current organization can read insights"
  on public.insights for select
  to authenticated
  using (organization_id = ((select auth.jwt()) ->> 'org_id'));

create index if not exists analyses_project_organization_idx
  on public.analyses(project_id, organization_id);
create index if not exists files_analysis_organization_idx
  on public.files(analysis_id, organization_id);
create index if not exists edges_analysis_organization_idx
  on public.edges(analysis_id, organization_id);
create index if not exists edges_source_file_organization_idx
  on public.edges(source_file_id, organization_id);
create index if not exists edges_target_file_organization_idx
  on public.edges(target_file_id, organization_id);
create index if not exists routes_analysis_organization_idx
  on public.routes(analysis_id, organization_id);
create index if not exists routes_file_organization_idx
  on public.routes(file_id, organization_id);
create index if not exists explanations_analysis_organization_idx
  on public.explanations(analysis_id, organization_id);
create index if not exists explanations_file_organization_idx
  on public.explanations(file_id, organization_id);
create index if not exists file_roles_analysis_organization_idx
  on public.file_roles(analysis_id, organization_id);
create index if not exists file_roles_file_organization_idx
  on public.file_roles(file_id, organization_id);
create index if not exists insights_analysis_organization_idx
  on public.insights(analysis_id, organization_id);
create index if not exists insights_file_organization_idx
  on public.insights(file_id, organization_id);
