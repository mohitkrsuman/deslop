-- Phase 15: what a change did to the map.
--
-- One comparison per analysis: the analysis is the "before", a named branch,
-- commit or pull request is the "after". Only the difference is stored, worked
-- out once by the pipeline from the two parses. Comparing again replaces the
-- row; re-running the analysis deletes it.
create table public.comparisons (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null unique references public.analyses (id) on delete cascade,
  -- Which run owns the row. A newer comparison takes it over, so a slower,
  -- older run can't overwrite the newer one when it finishes.
  run_id uuid not null,
  ref text not null check (char_length(ref) between 1 and 300),
  base_sha text not null,
  after_sha text,
  status text not null default 'queued' check (status in ('queued', 'analyzing', 'complete', 'failed')),
  stage text not null default 'queued'
    check (stage in ('queued', 'resolving', 'fetching', 'parsing', 'comparing', 'complete', 'failed')),
  stage_message text not null default 'Waiting to start',
  stage_started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  after_adapter text,
  after_coverage jsonb,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index comparisons_organization_id_idx on public.comparisons (organization_id);

-- Written only with the server key; members read their own organization's.
alter table public.comparisons enable row level security;
revoke all on table public.comparisons from anon, authenticated;
grant select (
  id, organization_id, analysis_id, ref, base_sha, after_sha, status, stage, stage_message,
  stage_started_at, finished_at, error_message, after_adapter, after_coverage, diff, created_at
) on table public.comparisons to authenticated;

create policy "Current organization can read comparisons"
  on public.comparisons for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

-- Live progress, on a topic named by the analysis it belongs to.
create policy "Organization can receive comparison progress"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and (select realtime.topic()) ~ '^comparison:[0-9a-f-]{36}$'
  and exists (
    select 1 from public.comparisons c
    where c.analysis_id::text = split_part((select realtime.topic()), ':', 2)
      and c.organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
  )
);

create function public.publish_comparison_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or
     (new.run_id, new.stage, new.stage_message) is distinct from (old.run_id, old.stage, old.stage_message) then
    perform realtime.send(jsonb_build_object(
      'id', new.analysis_id, 'stage', new.stage, 'message', new.stage_message,
      'status', new.status, 'stage_started_at', new.stage_started_at
    ), 'progress', 'comparison:' || new.analysis_id::text, true);
  end if;
  return new;
end;
$$;
revoke all on function public.publish_comparison_progress() from public, anon, authenticated;

create trigger comparisons_publish_progress
after insert or update of run_id, stage, stage_message on public.comparisons
for each row execute function public.publish_comparison_progress();
