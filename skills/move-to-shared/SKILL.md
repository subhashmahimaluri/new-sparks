---
name: move-to-shared
description: Relocates duplicated/common code into eq-one-shared and rewrites all importers across the affected MFEs. The mechanical half of @shared-curator's job.
kind: skill
id: move-to-shared
version: 0.1.0
status: draft
cacheable: false
---

# move-to-shared

## Description

Relocates duplicated or common code into **eq-one-shared** and rewrites every importer across the affected MFEs so nothing dangles. This is the **mechanical half of `@shared-curator`'s job**: the curator decides *what* is duplicated and *whether* it should move (judgment, escalation, dedup-policy); this skill performs the *move + rewrite + verify* (deterministic file surgery). Honours **dedup-policy** ("no repeat code / move to shared") and **path-policy** (only ever writes into `eq-one-shared` and the importing MFEs).

> Single-write rule: the destination is **always** `eq-one-shared`. Per the repo topology, child MFEs (`eq-one-saye-mfe`, `eq-one-sip-mfe`, `eq-one-shares-mfe`) are independent and MUST NOT duplicate code — anything reused MOVES here.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `source_paths` | yes | One or more absolute paths to the symbol(s)/module(s) to relocate (the duplicated/common code `@shared-curator` identified). |
| `dest_subpath` | yes | Target location inside `eq-one-shared` (e.g. `src/components/MoneyInput`). Must resolve under `eq-one-shared` or the skill refuses. |
| `affected_mfes` | yes | The set of MFEs known to import the code (used to scope the import rewrite and the dangling-import search). |
| `export_name` | no | Public symbol name to expose from the shared barrel/index; defaults to the existing export name. |
| `dry_run` | no | When true, report the planned moves and rewrites without writing. Default `false`. |

## Outputs

- The relocated file(s) under `eq-one-shared/<dest_subpath>`, with the shared package's barrel/index updated to export `export_name`.
- Every importer across `affected_mfes` rewritten to point at the `eq-one-shared` path; the old source files removed.
- A **dangling-import verification result**: PASS only when a repo-wide search for the *old* path returns zero matches.
- A change manifest (files moved, importers rewritten, old paths deleted) for `@shared-curator` to attach to its `self-evaluate` and for `@critic` to review.

## Tools Needed

- **Grep** — find every importer of the old path and run the final dangling-import search.
- **Glob** — enumerate candidate files across `affected_mfes`.
- **Read** — confirm contents before moving and resolve the real export name.
- **Edit** — rewrite import statements in place.
- **Write** — create the relocated file(s) in `eq-one-shared` and update its barrel/index.
- **Bash** — delete old source files and run path-existence checks.

## Constraints

- **cacheable: false.** This skill performs writes; per **cache-policy** writes are NEVER cached. Re-running must re-verify against live repo state.
- **path-policy:** writes are confined to `eq-one-shared` (destination) and the importing files inside `affected_mfes`. NEVER write into `eq-nexus-ui` routing/contracts, `eq-one-design-system`, or any BFF domain.
- Does not refactor logic or change public API shape — a **move**, not a rewrite. Behaviour-preserving only.
- Does not run tests or self-eval; the caller (`@shared-curator`) owns `self-evaluate` and the `@tester` / `@integration-tester` follow-up.
- Adds no runtime dependencies.

**fail_modes:**

- `DEST_OUT_OF_BOUNDS` — `dest_subpath` does not resolve under `eq-one-shared`. Refuse; do not write anywhere.
- `IMPORTER_OUTSIDE_SCOPE` — an importer found outside `affected_mfes` (e.g. in `eq-nexus-ui` or a BFF domain). Stop and escalate to `@decision`; do not partially rewrite.
- `DANGLING_IMPORTS_REMAIN` — the final search for the old path still returns matches. **FAIL** the skill; report the offending files so the run is not handed off broken.
- `SYMBOL_COLLISION` — `export_name` already exists in the `eq-one-shared` barrel. Refuse and surface for human/`@decision` resolution rather than overwrite.
- `NO_IMPORTERS_FOUND` — nothing imports the source. Warn (possible dead code); defer the move and let `@shared-curator` / `@scanner` confirm before deleting.

## When to invoke

- Inside the **/refactor-shared** orchestrator, after `@shared-curator` has identified duplicated/common code and `@decision` (if needed) confirmed REUSE/EXTEND over CREATE per **dedup-policy**.
- Whenever the same component, hook, store, or API client is detected in two or more child MFEs and must be consolidated into `eq-one-shared`.
- NOT for first-time creation of brand-new code, and NOT for code that belongs in `eq-one-design-system` (UI components the design system owns) or a BFF domain — route those to the correct owner.

## How it works

1. **Validate scope.** Resolve `dest_subpath` against `eq-one-shared`; refuse with `DEST_OUT_OF_BOUNDS` if it escapes. Read `source_paths` to confirm contents and the real export name.
2. **Map importers.** Grep + Glob across `affected_mfes` for every reference to the old path. Any hit outside `affected_mfes` triggers `IMPORTER_OUTSIDE_SCOPE` → escalate to `@decision`. Zero hits triggers `NO_IMPORTERS_FOUND` → warn and defer.
3. **Plan.** Build the change manifest (relocated file, barrel update, importer rewrites, deletions). If `dry_run`, emit the plan and stop here.
4. **Relocate.** Write the file(s) into `eq-one-shared/<dest_subpath>` and update the shared barrel/index to export `export_name` (refuse on `SYMBOL_COLLISION`).
5. **Rewrite importers.** Edit each importing file to point at the `eq-one-shared` path. Behaviour-preserving — imports only.
6. **Delete old sources.** Remove the now-relocated files from their original MFE locations.
7. **Verify no dangling imports.** Grep the *entire* affected surface for the **old path**. Any match → `DANGLING_IMPORTS_REMAIN` FAIL with the offending files listed. Zero matches → PASS.
8. **Hand back.** Return the change manifest + verification result to `@shared-curator` for `self-evaluate` and `@critic` review.

## Anti-patterns

- **Skipping step 7.** Moving the file and rewriting most importers but leaving one stale path is the classic break. The old-path search is the whole point — never finish without it.
- **Writing outside `eq-one-shared`.** Pushing common UI into a child MFE, into `eq-nexus-ui`, or hand-rolling a `eq-one-design-system` component instead of consolidating.
- **Refactoring while moving.** Renaming symbols, changing signatures, or "improving" logic mid-move hides regressions and bloats the diff `@critic` must reason about. Move first; refactor in a separate, reviewed change.
- **Caching the result.** This skill mutates the repo; treat every invocation as fresh and re-verify live.
- **Deleting on `NO_IMPORTERS_FOUND`.** Absence of importers may mean dead code — flag it for `@scanner`/`@shared-curator`, don't silently drop it.

## Example

`@shared-curator` finds an identical `MoneyInput` component in both `eq-one-saye-mfe` and `eq-one-sip-mfe`.

```
move-to-shared(
  source_paths = [
    ".../eq-one-saye-mfe/src/components/MoneyInput/index.tsx"
  ],
  dest_subpath = "src/components/MoneyInput",
  affected_mfes = ["eq-one-saye-mfe", "eq-one-sip-mfe"],
  export_name = "MoneyInput"
)
```

Result: `MoneyInput` now lives at `eq-one-shared/src/components/MoneyInput`, the shared barrel exports it, both MFEs import from `eq-one-shared`, the two original copies are deleted, and a Grep for the old `.../components/MoneyInput` paths returns **zero** matches → **PASS**.
