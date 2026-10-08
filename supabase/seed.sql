-- Replace these Clerk organization ids with the two organizations used for a
-- local acceptance check. Organizations are owned by Clerk; the policies read
-- the org_id claim from the Clerk token.

insert into public.projects (id, organization_id, name, repository_url)
values
  ('10000000-0000-0000-0000-000000000001', 'org_deslop_alpha', 'Alpha service', 'https://github.com/example/alpha'),
  ('20000000-0000-0000-0000-000000000002', 'org_deslop_beta', 'Beta service', 'https://github.com/example/beta')
on conflict (id) do nothing;

insert into public.analyses (id, organization_id, project_id, name, status)
values
  ('11000000-0000-0000-0000-000000000001', 'org_deslop_alpha', '10000000-0000-0000-0000-000000000001', 'Alpha service · initial map', 'complete'),
  ('21000000-0000-0000-0000-000000000001', 'org_deslop_beta', '20000000-0000-0000-0000-000000000002', 'Beta service · initial map', 'queued')
on conflict (id) do nothing;

update public.analyses
set finished_at = created_at + interval '5 minutes'
where id = '11000000-0000-0000-0000-000000000001'
  and status = 'complete'
  and finished_at is null;

insert into public.files (id, organization_id, analysis_id, path, language)
values
  ('11100000-0000-0000-0000-000000000001', 'org_deslop_alpha', '11000000-0000-0000-0000-000000000001', 'src/index.ts', 'TypeScript'),
  ('11100000-0000-0000-0000-000000000002', 'org_deslop_alpha', '11000000-0000-0000-0000-000000000001', 'src/server.ts', 'TypeScript'),
  ('21100000-0000-0000-0000-000000000001', 'org_deslop_beta', '21000000-0000-0000-0000-000000000001', 'src/index.ts', 'TypeScript')
on conflict (id) do nothing;

insert into public.edges (id, organization_id, analysis_id, source_file_id, target_file_id, kind)
values
  ('13000000-0000-0000-0000-000000000001', 'org_deslop_alpha', '11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000002', 'import')
on conflict (id) do nothing;

insert into public.routes (id, organization_id, analysis_id, file_id, method, path)
values
  ('14000000-0000-0000-0000-000000000001', 'org_deslop_alpha', '11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', 'GET', '/')
on conflict (id) do nothing;

insert into public.explanations (id, organization_id, analysis_id, file_id, body)
values
  ('15000000-0000-0000-0000-000000000001', 'org_deslop_alpha', '11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', 'The entry point wires the application together.')
on conflict (id) do nothing;

insert into public.file_roles (id, organization_id, analysis_id, file_id, role)
values
  ('16000000-0000-0000-0000-000000000001', 'org_deslop_alpha', '11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', 'entry point')
on conflict (id) do nothing;

insert into public.insights (id, organization_id, analysis_id, file_id, title, body)
values
  ('17000000-0000-0000-0000-000000000001', 'org_deslop_alpha', '11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', 'Entry point', 'This file starts the dependency map.')
on conflict (id) do nothing;
