-- Clerk is the source of truth for organizations. Remove the temporary local
-- mirror from the phase 02 migration while keeping organization_id on every
-- application row for tenant isolation and RLS.
--
-- Organization deletion is no longer a database cascade. If Clerk
-- organizations are deleted later, a Clerk webhook or server-side cleanup
-- operation must remove their rows from these eight tables explicitly.

drop table if exists public.organizations cascade;
