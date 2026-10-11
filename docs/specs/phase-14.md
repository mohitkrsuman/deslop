# Phase 14 — Private repositories

**Goal.** An organization can analyze its own private GitHub repositories, by
giving the app read access it controls, without anything else about the
product changing.

## Build

- **One GitHub token per organization**: a fine-grained personal access token
  with read-only Contents on the repositories it chooses. Setting, replacing
  and removing it is an admin action, in the same settings as the model key.
  Members can see that a token is set and nothing more.
- **Only fine-grained tokens are accepted.** A classic token can't be limited
  to chosen repositories, and the app has no use for wider access than reading.
  A classic token is refused at the form and the form says why.
- **The token is checked when it is saved**, with the smallest call that proves
  GitHub accepts it. A token that fails is refused with GitHub's reason.
- **Once saved, the token never comes back.** Settings show that it is set, its
  last four characters and when it expires, if GitHub reports that.
- When a token is set, every read from GitHub for that organization uses it:
  the commit lookup, the archive download and the single-file read behind
  Explain. Public repositories keep working, and get the higher rate limit.
- **An analysis records whether GitHub says the repository is private**, asked
  only when it is read with the organization's token; an anonymous read can
  only see a public one. The dashboard marks private analyses. A public
  repository read with the token is not marked.
- **A repository the token can't read fails with that reason.** GitHub answers
  "not found" for both a missing repository and one the token can't see; the
  message says both, and with a token set, names the token as the likely cause.

## Constraints

- **Encrypted at rest** with the same server-only secret and the same rules as
  the model key: decrypted for the request and nowhere else — not into logs,
  traces, error messages, progress events or the browser.
- Who may read the stored token is a policy. Nothing outside the
  organization's own server calls can reach it, and the agent never gets it —
  the agent reads the analysis from the database, not from GitHub.
- **No fallback to anonymous access.** If the token is rejected, expired or
  revoked, the read fails and says so. Retrying anonymously would hide a broken
  setup and, for a private repository, fail with a misleading reason anyway.
- An analysis of a private repository is readable by its organization only.
  That's already true of every analysis and every cached explanation; nothing
  here may introduce a cache or a row shared across organizations.
- Removing the token doesn't delete analyses already made. Their maps keep
  working. Anything that needs to read GitHub again, such as Explain or
  re-analyzing, fails with the reason.
- Sign-in stays identity only. No repository scope is requested from GitHub at
  sign-in.

## Acceptance check

1. As an admin, paste a classic token. It is refused, and the form says to use
   a fine-grained one.
2. Paste an invalid fine-grained token. It is refused with GitHub's reason.
3. Paste a valid one with read access to one private repository. Settings show
   that it is set and its last four characters. Reload and view the source: the
   token is not in it.
4. As a member of the same organization, open settings. You can see a token is
   set; there is no way to change it.
5. Analyze the private repository. It parses, the map draws, and the dashboard
   marks it private. The run's progress and trace have no token in them.
6. Explain a file in it. The explanation comes back.
7. Analyze a different private repository the token wasn't given. It fails,
   and the message names the token as the likely cause.
8. Sign in as a member of another organization. The private analysis isn't on
   their dashboard, and opening its URL shows nothing.
9. Revoke the token on GitHub, then explain a new file in the private analysis.
   It fails with GitHub's reason; the map is still there.
10. Remove the token. Public repositories still analyze. The private repository
    fails as "not found or not public".
