---
id: cache-policy
title: Cache Policy
version: 1.0.0
status: active
kind: guardrail
layer: agentic-os
category: cost-quality
summary: What eq-sparks caches, what it must never cache, per-run vs opt-in cross-run scope, Anthropic prompt-cache alignment, invalidation rules, and the telemetry every hit/miss emits.
applies_to: all agents, all skills, all orchestrators
owned_by: "@supervisor"
related: [budget-policy, dedup-policy, model-routing-policy, path-policy, safety-rails]
---

# Cache Policy

The platform must give strong output **under budget** — even leaning on Haiku — with **no repeated work**. Caching is the single biggest lever for that. This doc is the contract for what gets cached, what must never be, and how the cache is keyed, scoped, invalidated, and observed. It is one of the three cost pillars alongside `model-routing-policy` (the Haiku-first ladder) and `dedup-policy` (the no-repeat DNA check + task ledger).

There are **two distinct caches** in play and they must not be confused:

1. **Skill-output cache** — the platform's own per-run memoization of deterministic skill results. Implemented via the `cache-lookup` skill. Covered in §1–§4.
2. **Anthropic prompt cache** — the model-provider cache that discounts a repeated, byte-stable prompt prefix across the many LLM calls a run makes. Covered in §5. This is the biggest single token saver for a 20–50 dev fleet.

---

## 1. What IS cached (skill outputs)

The skill-output cache stores the result of **deterministic, read-only, expensive-to-recompute** skills, keyed `(skill_id, version, input_hash)`. A worker (or orchestrator) calls `cache-lookup` before invoking the skill; on a hit it skips the work entirely.

Cacheable skills:

| Skill | Why cacheable | Notes |
|---|---|---|
| `dna-precheck` | Pure function of the PBI + repo snapshot; runs BEFORE any codegen | Re-checking the same PBI against the same repo state is wasted work — `dedup-policy` relies on this being fast |
| `contract-diff` | Deterministic diff of an OpenAPI/Swagger contract vs FE TS types | Keyed on the contract + types hash; `@contract` / `@contract-tester` reuse it |
| `ado-context` (MCP:ado) | A work-item's fetched context is stable; persisted to the story cache | Title, description→markdown, AC, tags, parent epic, Figma URLs. Written to `.eq-sparks/cache/story-cache/<pbi>.json` — see the story-cache clause in §3. |
| `figma-context` (MCP:figma) | A Figma frame's context for the PBI is merged into the story cache | Frame hierarchy, text, styles, component names, render. Merged into the same `story-cache/<pbi>.json` under `figma` — see §3. |
| codebase-search | Same query against the same repo snapshot returns the same hits | Used by `@architect`, `@shared-curator`, `dna-precheck` |
| read-file | Same path at the same repo snapshot returns the same bytes | The cheapest, highest-frequency hit |

Rule of thumb: **if running it twice with the same inputs would produce the same output, it is cacheable.**

---

## 2. What is NEVER cached

Caching any of these produces **worse bugs than re-doing the work** — stale or incorrect results that silently corrupt a run.

- **apply-edit / writes** — every write mutates state; a cached "write" is a no-op that skips a real change. Writes must always execute.
- **run-tests** — a cached pass hides a real regression. Tests must run against current code, every time. (`@tester`, `@integration-tester`, `@contract-tester`.)
- **self-evaluate** — the mandatory final worker check must reflect the work *this* run actually produced; a cached confidence score defeats the escalation trigger in `model-routing-policy`.
- **raw LLM completions** — non-deterministic by construction. The platform never memoizes a model completion as a skill output. (Prompt-prefix reuse is handled separately by the Anthropic prompt cache — §5 — which is a provider-side discount, not a stored result we replay.)

These are non-negotiable. `safety-rails` treats a cache entry for any of the above as a defect.

---

## 3. Scope: per-run by default

**Default: per-run cache**, under:

```
.eq-sparks/cache/<run-id>/
```

- **Cleared at run start** — every run begins with an empty cache. No state leaks in from a previous run.
- **Discarded at run end** — the directory is dropped when the run completes (or its entries are invalidated; see §6).

**Why per-run and not persistent:** a long-lived cache across refactors is a foot-gun. After `@shared-curator` moves code to `eq-one-shared`, after a `/contract-sync`, or after any edit, a stale `read-file` / `codebase-search` / `contract-diff` entry would feed an agent a view of the repo that no longer exists. **Stale cache across refactors causes worse bugs than re-fetching.** Per-run scope bounds that blast radius to a single run, where the inputs genuinely don't change underneath the cache.

### Cross-run cache — OPT-IN only, OFF by default

For genuinely stable, repo-level metadata it is wasteful to re-fetch every run (e.g. a PBI's title/AC/parent epic, an epic's metadata), the platform supports an **opt-in** cross-run cache keyed:

```
(repo, profile, profile_version)
```

- **OFF by default.** A run must explicitly opt in. When off, everything is per-run.
- Only for **stable PBI/epic metadata** — never for code, contracts, search results, or anything that moves with the working tree.
- `profile_version` is the kill switch: bumping it invalidates every cross-run entry under that profile, so a metadata-shape change can't serve stale data.

If you are unsure whether something is stable enough for cross-run, it isn't — leave it per-run.

### Story cache — the single cross-run home for PBI + Figma context (skip-if-present, NO TTL)

The one deliberate, named exception to "opt-in cross-run with a TTL" is the **story cache**:

```
.eq-sparks/cache/story-cache/<pbi>.json
```

This is THE single home for a PBI's fetched context — the `ado-context` fields and the merged `figma-context` metadata (under a `figma` key) — keyed simply by PBI id. There is no competing run-folder `ado-context.json` / `figma-context.json`; this file is what every downstream agent and a later `/resume` read.

- **Present ⇒ skip — unconditionally, with NO TTL.** If `story-cache/<pbi>.json` exists, the ADO/Figma MCP call is **skipped** regardless of the file's age. Token saving wins over freshness: the user explicitly wants to avoid the ADO/Figma round-trip whenever the cache is present. The 600s cross-run TTL does **NOT** govern the story cache; `fetched_at` on the entry is informational only, never a TTL driver.
- **Re-fetch ONLY on explicit `refresh` or absence.** The story cache is re-fetched (overwriting the file) only when the orchestrator command carries an explicit `refresh` flag (e.g. `/scaffold PBI 37 refresh`) or the file is absent. It is never silently re-fetched.
- **Invalidation triggers (story cache only):** an explicit `refresh` flag on the orchestrator command, and `sync --clear-cache`. Run-end discard and the `profile_version` kill switch do **not** apply — the story cache lives outside the per-run `.eq-sparks/cache/<run-id>/` namespace and persists across runs by design.

---

## 4. Cache key & integrity

| Cache | Key | Stored |
|---|---|---|
| Per-run skill cache | `(skill_id, version, input_hash)` | The skill's output blob |
| Cross-run metadata cache | `(repo, profile, profile_version)` | Stable PBI/epic metadata |

- **`version`** is the skill's own version. A skill version bump changes the key, so an old cached output is never served to new logic (also an explicit invalidation trigger — §6).
- **`input_hash`** is a stable hash of the full, normalized input. Normalize before hashing (sort keys, canonical paths) so logically-identical inputs collide deterministically — the same discipline `prompt-caching` requires for byte-stable prefixes.
- A skill that touches the working tree should fold the relevant repo snapshot identity into `input_hash`, so an edit naturally produces a cache miss rather than a stale hit.

---

## 5. Anthropic prompt caching

This is separate from the skill-output cache and is **the biggest single token saver for a 20–50 dev fleet** — it pairs directly with the Haiku-first ladder in `model-routing-policy`, because a discounted stable prefix makes even cheap-tier calls cheaper still.

### The invariant

Anthropic prompt caching is a **prefix match**: any byte change anywhere in the prefix invalidates everything after it. Render order is `tools` → `system` → `messages`. So **every agent prompt must be structured stable-first, volatile-last**:

```
[ stable platform context | stable agent spec | volatile task ]
        (frozen)                 (frozen)            (changes every call)
```

- **stable platform context** — guardrail digests, repo topology, the cost model. Identical across every agent and every call in the fleet.
- **stable agent spec** — this agent's frozen instructions (its `.claude/agents/<id>.md` body). Identical across every call *to this agent*.
- **volatile task** — the PBI, the specific file, the per-call inputs. Changes every call. Put it **last**, after the final `cache_control` breakpoint.

A run makes many LLM calls (planning, codegen, review, the critic, self-eval). With this layout the stable prefix is written to the prompt cache once and **read** on every subsequent call within the TTL — at roughly **0.1× input price** instead of full price.

### Mechanics

- Mark the end of the stable prefix with `cache_control: {"type": "ephemeral"}` — **5-minute TTL** (the default). Long enough to cover a run's burst of calls.
- **Max 4 breakpoints** per request. Place one at the platform/agent-spec boundary and one at the end of the agent spec (before the volatile task).
- **Minimum cacheable prefix is model-dependent** — on Opus-tier (incl. Opus 4.8) it is **4096 tokens**; on Sonnet 4.6 it is 2048. A prefix shorter than the model's minimum **silently won't cache** (no error, `cache_creation_input_tokens: 0`). Keep the platform+agent prefix above the minimum or expect no discount.
- **Never put volatile bytes in the prefix.** A timestamp, run-id, UUID, or per-call task string interpolated into the platform/agent-spec section invalidates the whole prefix on every call — the classic silent cache-killer. Volatile content goes after the last breakpoint, full stop.
- Do **not** swap tools or the model mid-run — both render at/above the prefix and force a full rebuild. The Haiku-first ladder escalates by spawning a higher-tier call, not by mutating the in-flight prompt's model.

### Economics

Cache **reads** cost ~0.1× base input price; **writes** cost 1.25× (5-min TTL). Break-even is two calls — and a run makes far more than two — so for the fleet this is overwhelmingly net-positive. This is provider-side prompt-prefix discounting; it does **not** violate the "never cache raw LLM completions" rule in §2 — no completion is stored or replayed, only the input prefix is discounted.

---

## 6. Invalidation

A cache entry is invalidated by any of:

1. **Run end** — the per-run cache directory `.eq-sparks/cache/<run-id>/` is discarded.
2. **Skill version bump** — a new `version` changes `(skill_id, version, input_hash)`, so old outputs are unreachable by new logic. For the cross-run cache, a `profile_version` bump invalidates every entry under that profile.
3. **Manual** — `sync --clear-cache` wipes the cache explicitly. Use after an out-of-band repo change, or when debugging a suspected stale-hit.

**The story cache is exempt from triggers 1 and 2.** `.eq-sparks/cache/story-cache/<pbi>.json` is not in the per-run `<run-id>/` namespace, so it survives run-end, and the `profile_version` kill switch does not reach it. Its ONLY invalidation triggers are an explicit `refresh` flag on the orchestrator command and `sync --clear-cache` (§3). It has no TTL — present ⇒ skip ADO/Figma.

The Anthropic prompt cache invalidates on its own 5-minute TTL, on any prefix byte change, and on a model/tool change (§5) — nothing to manage manually beyond keeping the prefix stable.

---

## 7. Telemetry — every hit/miss is observable

**Every cache hit and miss emits telemetry**, surfaced in two places:

- The **standardised orchestrator console** (via `console-render`) — per-stage cache hit/miss counts so a developer watching a run sees reuse in real time.
- The **PR body** — a cache summary (hits, misses, hit-rate, estimated tokens/tool-calls saved) so reviewers can see the run stayed within budget and didn't repeat work.

This telemetry feeds `budget-check`, which tallies tool-call and token usage against the ceiling in `budget-policy`. A low hit-rate on a run that re-fetched ADO/Figma or re-searched the repo is a signal that the prompt prefix is being invalidated (a volatile byte in the stable section) or that a build agent skipped its `cache-lookup` pre-check — both are budget regressions worth flagging.

---

## Quick reference

| Question | Answer |
|---|---|
| Cache a skill output? | Only if deterministic + read-only: `dna-precheck`, `contract-diff`, `ado-context`, `figma-context`, codebase-search, read-file |
| Never cache? | apply-edit/writes, run-tests, `self-evaluate`, raw LLM completions |
| Key? | `(skill_id, version, input_hash)` per-run; `(repo, profile, profile_version)` cross-run |
| Default scope? | Per-run, `.eq-sparks/cache/<run-id>/`, cleared at start, discarded at end |
| Cross-run cache? | Opt-in only, OFF by default, stable PBI/epic metadata only. **Exception:** the story cache `story-cache/<pbi>.json` is the always-on cross-run home for PBI+Figma context, NO TTL, present ⇒ skip ADO/Figma (§3) |
| Prompt structure? | `[ stable platform | stable agent spec | volatile task ]`, breakpoint before the task, 5-min TTL |
| Invalidate? | Run end · skill version bump (or `profile_version` bump) · `sync --clear-cache`. **Story cache only:** explicit `refresh` flag or `sync --clear-cache` (no TTL, survives run-end) |
| Observed? | Every hit/miss → console (`console-render`) + PR body; tallied by `budget-check` |
