# DeSlop

DeSlop turns a public JavaScript or TypeScript GitHub repository into an interactive map of its real file dependencies. It is designed to help a developer understand an unfamiliar codebase by showing how files connect, what a file depends on, and what may be affected by changing it.



https://github.com/user-attachments/assets/36c0dfda-5a50-4a30-91a9-e71deab6d1fa



<!-- Add a project screenshot here when one is ready. -->

## Features

- **Organization workspaces:** Sign in through Clerk, switch organizations, invite teammates, and share each organization’s repository analyses. Supabase row-level security scopes stored data and progress updates to the active organization.
- **Repository analysis:** Submit a public GitHub repository URL. DeSlop fetches its archive without asking for GitHub repository access, records the commit analyzed, and saves one analysis per repository in the organization. Re-run it from its analysis page.
- **Live pipeline status:** Follow fetching, file selection, parsing, and storage as they happen. Failed runs include the stage and error; runs with no update for five minutes are marked stale.
- **Parser-backed dependency graph:** Parse JavaScript and TypeScript `import`, re-export, literal dynamic `import()`, and literal CommonJS `require()` references. Resolved local references become graph edges; external, excluded, unresolved, and skipped files are reported in the coverage details with reasons where available. Fan-in and fan-out counts come from the parsed edges.
- **Framework-aware file roles and routes:** Recognize Next.js, NestJS, React, and Express conventions, with a generic fallback. Extract exact routes for supported Next.js and NestJS patterns. Express files receive roles, but Express routes are left empty because routers are commonly assembled at runtime. Routes that cannot be recovered exactly are omitted rather than guessed.
- **Interactive map:** Fold directories into readable boxes, expand them into file rows, select files, and highlight their dependency connections. Filter by framework role while keeping the rest of the graph visible but dimmed.
- **Repository and file details:** Review repository totals, framework, routes, role counts, and coverage. A selected file shows its path, kind, line count, incoming and outgoing dependencies, and fan-in/fan-out. Click a listed file to select it on the map.
- **Graph calculations and insights:** Calculate a file’s dependency chain or blast radius to two levels by default. Inspect parser-derived import cycles, files with no dependents, unusually high fan-in, and long files. Framework entry points such as pages and routes are excluded from the no-dependents finding.
- **Theme and workspace controls:** Choose system, light, or dark appearance; the preference survives reloads.

The graph’s files and edges come from parsing source code. The Explanation tab is currently an empty state; AI explanations and repository question answering are not implemented yet.

## Requirements

- Node.js 20.9 or newer
- pnpm 12.9.1 (the version recorded in `package.json`)
- A Clerk application and a Supabase project

## Setup

1. **Configure Clerk.** Create a Clerk application, enable the sign-in methods you want, and enable organizations. Configure Clerk as a third-party authentication provider for your Supabase project so the session token includes the active organization ID (`org_id` or `o.id`). The app uses that claim to scope database access.

2. **Configure Supabase.** Create a project and have its URL, publishable key, and server-side secret key ready. Enable Supabase Realtime for the project; analysis progress uses private Broadcast channels.

3. **Add environment variables.** Create `.env.local` in the repository root:

   ```text
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
   CLERK_SECRET_KEY=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   SUPABASE_SECRET_KEY=
   ```

   Get the Clerk values from the Clerk application and the Supabase values from the project settings. `SUPABASE_SECRET_KEY` is used only on the server to write analysis results. Older projects can use `SUPABASE_SERVICE_ROLE_KEY` instead; never expose either key with a `NEXT_PUBLIC_` prefix.

4. **Apply the database migrations** to a fresh Supabase project, in filename order. In the Supabase SQL Editor, run the contents of each file from `supabase/migrations/`:

   ```text
   20261007092743_phase_02_dashboard.sql
   20261007092958_phase_02_rls_indexes.sql
   20261007105552_phase_02_clerk_organizations.sql
   20261007105601_phase_02_clerk_org_claim.sql
   20261007114204_add_finished_at_to_analyses.sql
   20261008094000_phase_07_pipeline.sql
   ```

   These create the schema and organization policies, then add pipeline stages, coverage fields, uniqueness constraints, and the private progress channel policy and trigger.

5. **Install and start the app.** From the repository root:

   ```bash
   pnpm install
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000), sign in, choose an organization, and submit a public URL such as `https://github.com/owner/repo`. The first analysis can take a while; progress updates appear as the pipeline advances.

The analysis request is configured for a maximum duration of 900 seconds. Deploy to a platform that allows that request duration; an interrupted run is reported as stale after five minutes without a stage update.

## Standalone parser

The parser can analyze a local checkout without starting the web app or contacting GitHub:

```bash
pnpm parse:repo path/to/repository --output analysis.json
```

Omit `--output analysis.json` to print the report without writing a result file. The report includes detected framework, files and skips, dependency edges, coverage, roles, routes, CommonJS exports, and unresolved references.

## Project commands

```bash
pnpm dev          # Start the development server
pnpm build        # Build the application
pnpm start        # Start the production server
pnpm lint         # Run ESLint
pnpm test:parser  # Run parser and adapter checks
pnpm test:graph   # Run graph and category checks
```

See [`docs/specs/`](docs/specs/) for the phase-by-phase product and implementation specifications.
