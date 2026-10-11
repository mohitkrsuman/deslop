-- Phase 13: the agent answers on the organization's own key.
--
-- The agent service asks for the key with the same grant its tools use. The
-- grant names one analysis, so this can only ever return that analysis's
-- organization's key. Security definer because the sealed column is readable
-- by no user token; the app decrypts it, and only for a valid grant.
--
-- Always one row for a valid grant: provider and ciphertext are null when the
-- organization has no key, which means the app's own key. No row means the
-- grant is invalid or expired.
create function public.agent_grant_model_key()
returns table (organization_id text, provider text, ciphertext text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.organization_id, k.provider, k.ciphertext
  from public.analyses a
  left join public.model_keys k on k.organization_id = a.organization_id
  where a.id = (select private.agent_grant_analysis())
$$;

revoke all on function public.agent_grant_model_key() from public, anon, authenticated;
grant execute on function public.agent_grant_model_key() to anon;
