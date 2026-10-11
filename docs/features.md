Cartograph takes a public GitHub URL and turns the repository into an interactive dependency map. Everything on the map comes from really parsing the code. The AI only explains what the parser found.

**Getting a repository in**
- **Sign-in and teams.** Clerk organizations; everything you analyse belongs to your team, and other teams can't see it.
- **Analyse by URL.** Paste a public GitHub URL. It downloads the code as an archive and records which commit it came from. No GitHub token is needed or stored.
- **Live progress.** The progress page shows each stage as it happens (fetch, select, parse, store). If a run fails, it says so instead of hanging.
- **One analysis per repository.** Pasting the same URL again takes you to the existing analysis. Re-running it is a deliberate action, and you can delete analyses.

**Parsing (the source of truth)**
- **Real import edges.** It reads `import`, re-exports, dynamic `import("...")` and `require("...")`. An edge appears only when an import resolves to a real file.
- **Nothing is guessed.** Imports it can't resolve, and files it skips, are counted and reported with a reason. A coverage banner warns when the map is partial.
- **Framework adapters.** For Next.js, React, NestJS and Express, it labels each file's role (page, controller, hook, service and so on) from naming conventions, and pulls out the routes.

**The map**
- **Folding.** Folders collapse automatically so a large repository fits on screen as about two dozen nodes.
- **Opening folders.** Clicking a folder opens it as a panel listing its files.
- **Node size.** A taller node means more files depend on it.
- **Selection.** Selecting a file highlights its edges and neighbours and dims everything else.
- **Left rail.** Pick a file category and everything outside it dims, so you can see where that kind of file lives without losing the overall shape.
- **Routes table.** The routes the adapters extracted.

**The detail pane**
- **With nothing selected:** a summary of the repository, covering framework, file and import counts, the most depended-on files, and files nothing imports (where to start reading).
- **Structure tab:** a file's path, role, size, and full lists of what it imports and what imports it. Every path is clickable, and hovering highlights the same file on the map and in the pane.
- **Blast radius:** what could break if this file changes.
- **Dependency chain:** what this file needs. Both are instant, two levels deep, with no model involved.
- **Insights:** import cycles, files nothing imports, files imported unusually often, and very long files. These are plain facts from the edge list, never scores, and the panel starts collapsed.

**Explain (the AI)**
- **Explain a file.** The explanation is written from the file's real source plus its real neighbours. File paths in it are links, and inline code, bullets and bold are shown as formatted text.
- **Explain a folder.** It covers what's inside the folder and why so much points at it.
- **Classifying leftover files.** Files no adapter could identify get a role, limited to non-structural roles.
- **Cached by content.** An unchanged file is never paid for twice.
- **Staleness check.** If the repository has new commits, it offers to re-analyse.
- **Visible tracing.** Every AI call is traced in LangSmith, and the app shows whether tracing is on.

**Evals (proving the AI's answers are good)**
- **Invented-path check.** It runs live on every explanation and flags any path that wasn't in what the model was shown or in the file's source.
- **`pnpm eval:roles`.** Measures how often the AI's role matches the convention label on files whose role is already known.
- **`pnpm eval:prompts`.** Compares the current prompt against a retired one as two LangSmith experiments, scored on specificity by a separate judge model, plus the invented-path check.