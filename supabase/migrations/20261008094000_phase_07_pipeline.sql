-- One durable map per organization and canonical GitHub repository.
alter table public.analyses
  add column stage text not null default 'queued',
  add column stage_message text not null default 'Waiting to start',
  add column stage_started_at timestamptz not null default now(),
  add column error_message text,
  add column failed_stage text,
  add column commit_sha text,
  add column adapter text,
  add column coverage jsonb,
  add column coverage_percent numeric(5,2),
  add column import_count integer;

alter table public.analyses add constraint analyses_stage_check
  check (stage in ('queued', 'fetching', 'selecting', 'parsing', 'storing', 'complete', 'failed'));
alter table public.analyses add constraint analyses_coverage_percent_check
  check (coverage_percent between 0 and 100);

update public.analyses
set stage = case status
    when 'complete' then 'complete' when 'failed' then 'failed'
    when 'analyzing' then 'parsing' else 'queued' end,
  stage_message = case status
    when 'complete' then 'Map ready' when 'failed' then 'Previous run failed'
    when 'analyzing' then 'Previous run was analyzing' else 'Waiting to start' end,
  stage_started_at = coalesce(finished_at, created_at);

alter table public.files
  add column folder text,
  add column module_id text,
  add column kind text,
  add column line_count integer,
  add column sha256 text,
  add column fan_in integer,
  add column fan_out integer;

-- Keep the newest row when older data contains duplicate projects or runs.
delete from public.projects p
using public.projects newer
where p.organization_id = newer.organization_id
  and p.repository_url = newer.repository_url
  and (p.created_at, p.id) < (newer.created_at, newer.id);

delete from public.analyses a
using public.analyses newer
where a.project_id = newer.project_id
  and (a.created_at, a.id) < (newer.created_at, newer.id);

create unique index projects_organization_repository_url_key
  on public.projects (organization_id, repository_url);
create unique index analyses_one_per_project_key
  on public.analyses (project_id);

-- This policy registers both topic patterns before the trigger can publish.
-- A client can receive only its own organization's analysis or dashboard feed.
create policy "Organization can receive analysis progress"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast' and (
    (
      (select realtime.topic()) ~ '^analysis:[0-9a-f-]{36}$'
      and exists (
        select 1 from public.analyses a
        where a.id::text = split_part((select realtime.topic()), ':', 2)
          and a.organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
      )
    ) or (
      (select realtime.topic()) = 'analyses:org:' ||
        (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    )
  )
);

create function public.publish_analysis_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  payload jsonb;
begin
  if tg_op = 'INSERT' or
     (new.stage, new.stage_message) is distinct from (old.stage, old.stage_message) then
    payload := jsonb_build_object(
      'id', new.id, 'stage', new.stage, 'message', new.stage_message,
      'status', new.status, 'stage_started_at', new.stage_started_at
    );
    perform realtime.send(payload, 'progress', 'analysis:' || new.id::text, true);
    perform realtime.send(payload, 'progress', 'analyses:org:' || new.organization_id, true);
  end if;
  return new;
end;
$$;
revoke all on function public.publish_analysis_progress() from public, anon, authenticated;

create trigger analyses_publish_progress
after insert or update of stage, stage_message on public.analyses
for each row execute function public.publish_analysis_progress();
