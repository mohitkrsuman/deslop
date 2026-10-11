-- Phase 13: an organization's own model key.
--
-- One row per organization. The key is sealed by the app before it arrives
-- (AES-256-GCM, bound to the organization ID), so this table never holds it in
-- the clear. No user token can read the sealed column: members may read which
-- provider is in use and the last four characters, nothing else. Only server
-- code, holding the decryption secret, reads the sealed column.
create table public.model_keys (
  organization_id text primary key,
  provider text not null check (provider in ('anthropic', 'openai')),
  ciphertext text not null,
  last_four text not null check (char_length(last_four) = 4),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.model_keys enable row level security;
revoke all on table public.model_keys from anon, authenticated;
grant select (organization_id, provider, last_four, updated_at) on table public.model_keys to authenticated;
grant insert (organization_id, provider, ciphertext, last_four, updated_at) on table public.model_keys to authenticated;
grant update (provider, ciphertext, last_four, updated_at) on table public.model_keys to authenticated;
grant delete on table public.model_keys to authenticated;

create policy "Current organization can see its model key's provider"
  on public.model_keys for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

-- Setting, replacing and removing the key is an admin action. The role comes
-- off the Clerk session token, in either claim shape.
create policy "Organization admins can set the model key"
  on public.model_keys for insert
  to authenticated
  with check (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    and (select coalesce(auth.jwt() ->> 'org_role', 'org:' || (auth.jwt() -> 'o' ->> 'rol'))) = 'org:admin'
  );

create policy "Organization admins can replace the model key"
  on public.model_keys for update
  to authenticated
  using (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    and (select coalesce(auth.jwt() ->> 'org_role', 'org:' || (auth.jwt() -> 'o' ->> 'rol'))) = 'org:admin'
  )
  with check (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
  );

create policy "Organization admins can remove the model key"
  on public.model_keys for delete
  to authenticated
  using (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    and (select coalesce(auth.jwt() ->> 'org_role', 'org:' || (auth.jwt() -> 'o' ->> 'rol'))) = 'org:admin'
  );
