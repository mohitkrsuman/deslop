-- A run has a finish time only after it completes or fails.
alter table public.analyses
  add column if not exists finished_at timestamptz;

-- Backfill the existing sample runs in the connected project.
update public.analyses
set finished_at = created_at + case id
  when '41000000-0000-0000-0000-000000000001'::uuid then interval '4 minutes'
  when '41000000-0000-0000-0000-000000000004'::uuid then interval '2 minutes'
  when '31000000-0000-0000-0000-000000000005'::uuid then interval '3 minutes'
end
where id in (
  '41000000-0000-0000-0000-000000000001'::uuid,
  '41000000-0000-0000-0000-000000000004'::uuid,
  '31000000-0000-0000-0000-000000000005'::uuid
)
and finished_at is null
and status in ('complete', 'failed');
