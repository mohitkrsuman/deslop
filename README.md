# DeSlop

DeSlop maps imports in a public GitHub repository for a Clerk organization. The dashboard accepts a repository URL, shows live pipeline progress, and opens the stored graph.

## Setup

Install dependencies with `pnpm install`. Set these server and public environment variables:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

`SUPABASE_SECRET_KEY` is a server-only Supabase secret key for inserting projects, analyses, files, and edges. A legacy `SUPABASE_SERVICE_ROLE_KEY` is also accepted. Never prefix either with `NEXT_PUBLIC_`. The existing Clerk/Supabase integration must supply an organization claim in the Clerk session token.

Apply `supabase/migrations/20261008094000_phase_07_pipeline.sql` after the earlier migrations. This adds the one-analysis constraint, coverage data, progress trigger, and private Realtime subscription policy. The migration keeps the newest row when an older organization has duplicate project URLs or duplicate analyses for a project. Realtime must be enabled for the Supabase project; clients join private channels using their Clerk session token.

Run `pnpm dev` and open the dashboard. Paste an `https://github.com/owner/repo` URL. GitHub's public API and archive download are used without a repository scope or stored GitHub token. Re-run an existing repository from its analysis page. The worker runs after the form response, within the route's 300-second maximum duration. A deployment platform must support that duration; if it stops early, the dashboard labels the stage stale after five minutes.

## Parser and checks

Run `pnpm parse:repo path/to/repository --output analysis.json` to inspect a local repository independently. `pnpm test:parser`, `pnpm test:graph`, `pnpm exec eslint app components lib tests proxy.ts`, and `pnpm build` check the parser and app.
