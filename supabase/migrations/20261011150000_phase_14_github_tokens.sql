-- Phase 14: an organization's own read-only GitHub token, for private
-- repositories.
--
-- One row per organization, sealed by the app before it arrives, exactly like
-- the model key. No user token can read the sealed column: members may read
-- that one is set, its last four characters and when GitHub says it expires.
-- Only server code, holding the decryption secret, reads the sealed column.
-- The agent never needs it: it reads the analysis from the database, so no
-- function here hands the token to a grant.
create table public.github_tokens (
  organization_id text primary key,
  ciphertext text not null,
  last_four text not null check (char_length(last_four) = 4),
  expires_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.github_tokens enable row level security;
revoke all on table public.github_tokens from anon, authenticated;
grant select (organization_id, last_four, expires_at, updated_at) on table public.github_tokens to authenticated;
grant insert (organization_id, ciphertext, last_four, expires_at, updated_at) on table public.github_tokens to authenticated;
grant update (ciphertext, last_four, expires_at, updated_at) on table public.github_tokens to authenticated;
grant delete on table public.github_tokens to authenticated;

create policy "Current organization can see its GitHub token is set"
  on public.github_tokens for select
  to authenticated
  using (organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

create policy "Organization admins can set the GitHub token"
  on public.github_tokens for insert
  to authenticated
  with check (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    and (select coalesce(auth.jwt() ->> 'org_role', 'org:' || (auth.jwt() -> 'o' ->> 'rol'))) = 'org:admin'
  );

create policy "Organization admins can replace the GitHub token"
  on public.github_tokens for update
  to authenticated
  using (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    and (select coalesce(auth.jwt() ->> 'org_role', 'org:' || (auth.jwt() -> 'o' ->> 'rol'))) = 'org:admin'
  )
  with check (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
  );

create policy "Organization admins can remove the GitHub token"
  on public.github_tokens for delete
  to authenticated
  using (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    and (select coalesce(auth.jwt() ->> 'org_role', 'org:' || (auth.jwt() -> 'o' ->> 'rol'))) = 'org:admin'
  );

-- GitHub's own answer to whether the repository is private, recorded when it
-- was read with the organization's token. An anonymous read can only ever see
-- a public repository, so false is never a guess.
alter table public.analyses add column private boolean not null default false;
