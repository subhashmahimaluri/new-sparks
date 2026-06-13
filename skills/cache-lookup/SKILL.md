---
name: cache-lookup
description: The cache primitive — get(skill_id, version, input_hash) returns hit|miss and put(...) stores a skill output. Per-run scope by default under .eq-sparks/cache/<run-id>/. Implements cache-policy and emits cache:hit / cache:miss telemetry for the console "Cache hit" line.
kind: skill
id: cache-lookup
version: 0.1.0
status: draft
---

# cache-lookup

## Description

`cache-lookup` is the single low-level cache primitive for the eq-sparks platform. It is the mechanism that every other "fetch" or "scan" skill leans on to avoid repeated work. It exposes exactly two operations:

- `get(skill_id, version, input_hash)` -> **hit** (returns the stored output) or **miss**.
- `put(skill_id, version, input_hash, output)` -> stores a skill output under that key.

It is the concrete implementation of the rules in `cache-policy`. It does NOT decide *what* is cacheable — callers (and `cache-policy`) decide that — it only stores and retrieves by an explicit, content-addressed key. Default scope is **per-run**, on disk under `.eq-sparks/cache/<run-id>/`. Each call emits structured telemetry (`cache:hit` / `cache:miss`) that the `console-render` skill aggregates into the orchestrator Summary "Cache hit" line.

This skill is the one place the cache lives. It is never used to short-circuit apply-edit, run-tests, self-evaluate, or LLM completions (see Constraints).

## Inputs

For `get`:
- `skill_id` (string, required) — the id of the calling skill (e.g. `dna-precheck`, `contract-diff`, `ado-context`).
- `version` (string, required) — the caller skill's version, so a bumped skill never reads a stale prior-version entry.
- `input_hash` (string, required) — a stable content hash of the caller's full input set (PBI id, repo paths/SHAs, args). The caller computes this; the cache treats it as opaque.
- `scope` (enum, optional) — `run` (default, keyed under `.eq-sparks/cache/<run-id>/`) or `cross-run` (opt-in, only for stable PBI metadata per `cache-policy`).
- `run_id` (string, required for `scope: run`) — supplied by `@supervisor`.

For `put`: all of the above, plus
- `output` (object, required) — the serialisable skill output to store.
- `ttl_seconds` (number, optional) — overrides the policy default; honour `cache-policy` for the cross-run TTL.

## Outputs

For `get`:
- `status` — `hit` | `miss`.
- `value` — the stored output object on `hit`; `null` on `miss`.
- `key` — the resolved cache key `(skill_id@version, input_hash, scope)` for logging.
- `telemetry` — one event, `cache:hit` or `cache:miss`, with `{ skill_id, version, input_hash, scope, run_id }`.

For `put`:
- `status` — `stored` | `skipped` (skipped when the caller/key is on the non-cacheable list).
- `key` — the resolved cache key.

## Tools Needed

- `Read` — read the cache entry file on a `get`.
- `Write` — write the cache entry file on a `put`.
- `Bash` — compute/verify the on-disk path, check existence, and apply TTL expiry (mtime check). No network. No package installs.

## Constraints

- **cacheable: n/a (this IS the cache primitive).** This skill is the cache, so it is not itself cached.
- **Never cache these (hard block, per `cache-policy`):** apply-edit / writes, run-tests, `self-evaluate`, and any LLM completion. On a `put` whose `skill_id` matches that deny-list, return `status: skipped` and do not write. This keeps the cache deterministic and prevents serving stale or non-idempotent results.
- **Key is the full triple.** A `get` only hits when `skill_id`, `version`, AND `input_hash` all match. Any drift = `miss`. Never fuzzy-match.
- **Per-run isolation by default.** `run` scope is namespaced under `.eq-sparks/cache/<run-id>/` and never leaks across runs. `cross-run` is opt-in and limited to stable PBI metadata.
- **Path discipline (per `path-policy`).** Read/Write only inside `.eq-sparks/cache/`. Never write into consumer-repo source trees.
- **No secrets / no PII.** Do not store auth tokens, credentials, or PII in cache values; if a caller's output may contain them, the caller must redact before `put` (see `safety-rails`).
- **Distinct from Anthropic prompt-cache.** This is the skill-output cache. The 5-min prompt-cache prefix alignment is a separate mechanism described in `cache-policy`; this skill does not manage it.
- **fail_modes:**
  - Corrupt/unparseable entry on `get` -> treat as `miss`, emit `cache:miss`, and the caller recomputes. Never crash the run on a bad entry.
  - Expired entry (mtime past TTL) -> `miss`.
  - Missing `run_id` for `scope: run` -> error back to caller; do not fall back to a shared namespace.
  - Cache dir unwritable -> log and degrade to no-cache (every `get` is a `miss`, every `put` is `skipped`); the run still proceeds, just without savings.

## When to invoke

- At the **start** of any cacheable fetch/scan skill — call `get` first; on `hit`, skip the work and return the cached value. This is mandatory for `ado-context`, `figma-context`, `contract-diff`, `dna-precheck`, and other read-only/mechanical skills.
- At the **end** of those same skills — call `put` to store the fresh output for the rest of the run.
- Do **not** invoke from `self-evaluate`, the apply/edit step, the test runners, or around any LLM completion.

## How it works

1. Caller computes `input_hash` over its complete input set and calls `get(skill_id, version, input_hash, scope, run_id)`.
2. Resolve the path: `scope: run` -> `.eq-sparks/cache/<run-id>/<skill_id>@<version>/<input_hash>.json`; `scope: cross-run` -> `.eq-sparks/cache/_shared/<skill_id>@<version>/<input_hash>.json`.
3. If the file is absent, unparseable, or past its TTL -> emit `cache:miss` and return `{ status: miss, value: null }`.
4. If present and valid -> emit `cache:hit` and return `{ status: hit, value }`. Caller skips its work.
5. On a `miss`, the caller does its work, then calls `put(...)` with the `output`.
6. On `put`, check the non-cacheable deny-list (apply-edit / run-tests / self-evaluate / LLM completions). If matched -> `status: skipped`, no write.
7. Otherwise write the entry atomically (temp file + rename) at the resolved path, stamping `stored_at` for TTL.
8. `console-render` rolls the run's `cache:hit` / `cache:miss` events into the Summary "Cache hit" line; `budget-check` credits the avoided work.

## Anti-patterns

- Caching writes, test runs, `self-evaluate`, or LLM completions. Hard no — these are non-idempotent and must always run fresh.
- Reusing a `get` across a version bump by omitting `version` from the key — silently serves stale logic.
- Sharing one namespace across runs by default, or guessing a `run_id` — breaks per-run isolation.
- Fuzzy/partial key matching to "increase hit rate" — only an exact triple match is a hit.
- Storing secrets or PII in cache values.
- Crashing the run on a corrupt entry instead of degrading to `miss`.

## Example

```
# dna-precheck, at its start:
get(
  skill_id   = "dna-precheck",
  version    = "0.1.0",
  input_hash = "sha256:<pbi-id + repo SHAs + paths>",
  scope      = "run",
  run_id     = "<from @supervisor>"
)
-> { status: "miss", value: null }        # emits cache:miss

# ... dna-precheck does its cross-repo scan ...

put(
  skill_id   = "dna-precheck",
  version    = "0.1.0",
  input_hash = "sha256:<...>",
  output     = { classification: "extend", target: "eq-one-shared", ... },
  scope      = "run", run_id = "<...>"
)
-> { status: "stored" }

# A later agent in the SAME run, same inputs:
get(... same triple ...) -> { status: "hit", value: { classification: "extend", ... } }
# emits cache:hit -> console "Cache hit" line increments; work skipped.
```
