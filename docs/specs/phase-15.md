# Phase 15 — What a change did to the map

**Goal.** After an AI (or anyone) changes a repository, the user can see
exactly which files and imports that change added and removed, on the map they
already know, from the parser alone.

## Build

- **Compare with a change.** From a complete analysis, the user names the
  "after": a branch, a commit SHA or a pull request in the same repository. It
  is resolved to one exact commit before anything is read, and both commits are
  shown on the comparison: base commit → after commit.
- **The after side is parsed exactly like an analysis**, with the same live
  progress, the same limits and the same organization GitHub token, so private
  repositories and pull request branches work the same way.
- **One comparison per analysis.** Comparing again replaces it, and it can be
  removed by hand. Re-running the base analysis discards its comparison,
  because its "before" no longer exists.
- **What counts as a difference**, and nothing else:
  - a file added or removed, by path;
  - a file whose content changed, by its content hash;
  - an import line added or removed, by the pair of files it joins;
  - the change in coverage: files skipped and imports left unresolved, each
    with its reason, on both sides.
- **On the map.** The map is drawn once over both sides together, so turning
  the comparison on or off moves nothing. Added files and lines take one colour,
  removed ones are drawn as faint outlines in another, changed files carry a
  mark, and everything unchanged is dimmed. A folded folder shows how many
  files inside it were added, removed and changed.
- **A side list** with the counts and the paths, grouped as added, removed,
  changed. Clicking a path opens its folder and selects it on the map.
- Explain, Ask and labelling stay on the base analysis. The after side gets no
  model calls in this phase.

## Constraints

- **A rename is a removal and an addition.** The parser sees two paths; it never
  decides that one became the other.
- **Same path, same hash, same file.** No fuzzy matching of files or imports. An
  import line differs only if the parser resolved it on one side and not the
  other, or resolved it to a different file.
- A ref that doesn't exist, or that the token can't read, fails with that
  reason. It is never swapped for the default branch.
- If the after side can't be parsed completely, its coverage says so, and those
  files aren't reported as removed. Unparsed is not deleted.
- No judgement of the change. No "risk", no score, no good or bad colours. The
  added and removed colours mean added and removed and are used for nothing else.
- A comparison is readable by its organization only, like every analysis.

## Acceptance check

1. On a complete analysis, compare with a branch that adds one file importing
   an existing one. The progress shows, then the map shows the new file and its
   line in the "added" colour; everything else is dimmed.
2. The side list shows 1 added file, 1 added import, and the base and after
   commits.
3. Turn the comparison off and on. Nothing on the map moves.
4. Compare with a branch that deletes a file. It is drawn as a faint outline
   where it was, with its lines, in the "removed" colour.
5. Compare with a branch that renames a file. It shows as one removed and one
   added, never as a rename.
6. Compare with a branch that only edits a file's body. It is marked changed;
   no import lines are added or removed.
7. Fold the folder holding those files. The folder shows the counts.
8. Compare with a pull request on a private repository with the organization's
   token set. It works. With the token removed, it fails with the reason.
9. Compare with a branch that doesn't exist. It fails saying so, and the base
   map is untouched.
10. Run the base analysis again. The comparison is gone.
