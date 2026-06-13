---
id: memory-schema
version: 1.0.0
status: active
kind: guardrail
title: Memory Schema
description: The two-layer memory contract for eq-sparks — a per-run scratchpad (Layer 1) that carries the idempotent task ledger, and human-curated cross-run lessons (Layer 2) prepended to agent prompts. Single source of truth across the autonomous and IDE paths.
applies_to: all-agents, all-orchestrators
related: dedup-policy, cache-policy, budget-policy, path-policy, safety-rails
---

# Memory Schema

Memory is how eq-sparks gets **strong output under budget with no repeated work**. It is deliberately small and deliberately two-layered. Layer 1 is machine-written and disposable; Layer 2 is human-curated and durable. Keeping them separate is what protects the prompt-cache prefix (see `cache-policy`) and keeps resumes idempotent (see `dedup-policy`).

This file is the **single source of truth** for both the autonomous (cloud `/scaffold`, `/review`, …) path and the IDE path. The `/resume` orchestrator (Flow 3 cloud→IDE handoff) reads Layer 1 to pick up exactly where a prior run stopped — without re-fetching ADO or Figma.

| | Layer 1 — Per-run scratchpad | Layer 2 — Cross-run lessons |
|---|---|---|
| **Path** | `.eq-sparks/agent-memory/<run-id>/scratchpad.md` (+ `ledger.jsonl`, `handoff/`, `metadata.json`) | `shared/memory/lessons.md` |
| **Written by** | Agents (automatically, during the run) | Humans (manually, from telemetry) |
| **Lifetime** | One run; disposable | Durable; versioned in git |
| **Purpose** | Carry the idempotent task ledger; record reasoning + outcome | Inject hard-won patterns into future runs |
| **Cacheable?** | No (volatile, see `cache-policy`) | Yes — part of the stable prompt prefix |

> Path discipline: `.eq-sparks/` is **gitignored** in consumer repos and synced from this monorepo. Agents write Layer 1 only under `.eq-sparks/agent-memory/`; Layer 2 lives only at `shared/memory/lessons.md`. Anything else is a `path-policy` violation.

---

## Layer 1 — Per-run scratchpad

Layer 1 lives under the per-run directory `.eq-sparks/agent-memory/<run-id>/`, with the working memory in `scratchpad.md` (see the [Runtime layout](#runtime-layout-concrete) below). It is the run's working memory and the resume anchor. It is **never cached** — it changes every turn.

### Run header (metadata.json)

The run header that was once carried as scratchpad frontmatter now lives in its own `metadata.json` (per the [Runtime layout](#runtime-layout-concrete) below), so the scratchpad is pure working memory:

```json
{
  "run_id": "2026-06-13-scaffold-PBI-48213-a7f1",
  "pbi_id": 48213,
  "orchestrator": "scaffold",
  "stages": ["initiate", "ado-fetch", "figma", "dna-precheck", "preview", "generate", "review", "summary"],
  "profile": "fe-childmfe",
  "branch": "feat/saye-maturity-summary",
  "started_at": "2026-06-13T09:14:22Z"
}
```

`run_id` MUST equal the `<run-id>` segment of the directory path. `profile` MUST be one of the five canonical profiles defined in `CLAUDE.md` §6 and `.eq-sparks.yml.example` (`fe-rootmfe | fe-childmfe | fe-shared | fe-designsystem | be-experienceapi`) so Layer 2 lessons can be filtered against it (see below); any owning `agent` id recorded for a scratchpad section MUST be an exact id from the 23-agent roster. **`orchestrator`** is the id of the originating slash-command (`scaffold | code-builder | fix-defect | review | unit-test | contract-sync | refactor-shared | fix-pentest | security | performance | accessibility`) and **`stages`** is the ordered stage/`task_id` list, both written at Stage 0 — together they are the resume re-entry map: `/resume` reads `orchestrator` to re-enter the correct orchestrator and walks `stages` against `ledger.jsonl` to find the first `pending` stage.

### Sections (in this order)

1. **Hypothesis** — what the agent believes the task is and how it intends to approach it, before doing work. One short paragraph.
2. **Investigation log** — append-only, timestamped notes: repos/files inspected, `dna-precheck` verdicts, `cache-lookup` hits/misses, `contract-diff` results. Cite real paths. This is the audit trail `@critic` and humans read.
3. **Decision** — any `@decision` fork resolved during the run (vague PBI, missing contract, code placement, reuse-vs-create), with the **rationale** recorded for human review. Mirror the `@decision` log entry here so a resume sees it.
4. **Self-eval result** — the `self-evaluate` output before handoff: confidence score (0.0–1.0) and notes. A score `< 0.7` is the documented trigger to escalate one model rung (see `model-routing-policy`); record the escalation here if it happened.
5. **Task ledger** — the idempotent ledger from `dedup-policy`. The heart of resume. See below.
6. **Outcome** — final state when the agent hands off: `complete | blocked | escalated | handoff`, plus a one-line summary and any follow-ups for the next stage.

### Task ledger (idempotent — from `dedup-policy`)

The ledger lets a `/resume` skip work that is already done. Each entry is one atomic unit of work keyed by a stable `task_id` derived from the task definition (not from time), so the same task always resolves to the same row.

```markdown
## Task ledger
| task_id                | desc                                  | classification | status   | artifact_path                                  | content_hash |
|------------------------|---------------------------------------|----------------|----------|------------------------------------------------|--------------|
| saye-route-wiring      | Wire saye MFE into eq-nexus-ui shell  | EXTEND         | done     | eq-nexus-ui/src/routes/saye.tsx                | 9f3c…        |
| saye-balance-store     | Balance Zustand store                 | REUSE          | done     | eq-one-shared/src/stores/useBalanceStore.ts    | b21a…        |
| saye-summary-card      | Summary card component                | CREATE         | pending  | —                                              | 4d7e…        |
```

Rules:
- **`status` is the resume gate.** `done` is NOT re-executed on resume; `pending` is; `blocked` is surfaced to `@supervisor` for the go/no-go call.
- **`classification`** is the `dna-precheck` verdict and MUST follow the reuse precedence `REUSE > EXTEND > CREATE` from `dedup-policy`. A `REUSE` row points `artifact_path` at the existing artifact (often in `eq-one-design-system` or `eq-one-shared`) and is marked `done` (deliberately skipped) — no new code.
- **`content_hash`** is the hash of the task's resolved inputs. If inputs change between runs the hash changes, the row is treated as new, and it re-executes — keeping the ledger idempotent but not stale.
- **No LLM output, writes, tests, or `self-evaluate` results are cached** (see `cache-policy`); the ledger records *whether* work happened, not a cached *result* to replay.

#### Resume semantics (`/resume`)

`/resume <run-id>` reads `.eq-sparks/agent-memory/<run-id>/` (`metadata.json` + `scratchpad.md` + `ledger.jsonl` + last `handoff/*.json` envelope) and:
1. Reads `metadata.orchestrator` to know **which** orchestrator started the run, and `metadata.pbi_id` to locate the **story cache** at `.eq-sparks/cache/story-cache/<pbi>.json` — the single cross-run home for the fetched PBI + Figma context. It **does not** re-run `ado-context` or `figma-context`; the fetched context is the story cache, read by pbi id.
2. Loads the Task ledger and Decision section; skips every `done` row; re-enters `metadata.orchestrator`'s stage sequence at the first `pending` row.
3. Re-applies the recorded `@decision` rationales rather than re-deciding, so the resumed run is consistent with the original.

This is what makes the cloud→IDE handoff (and a locally-interrupted run — same ledger replay) free: the IDE picks up the same ledger the original run wrote, and the story cache it already populated.

---

## Layer 2 — Cross-run lessons

One curated file at `shared/memory/lessons.md`. It is **manually curated by humans** from run telemetry. Agents read it; agents do not write it.

### The curation bar (strict)

- A lesson is added **only after 3+ runs confirm the same pattern.** One-off observations are not lessons.
- **Speculative lessons are rejected.** "This might help" is not admissible. A lesson must cite the runs that evidenced it.
- Lessons are reviewed and merged by a human (Senior Solution Architect / owning lead), the same way a guardrail change is.
- Lessons are **retired** when they stop being confirmed or when the underlying guardrail/topology changes. A stale lesson is worse than no lesson because it costs prompt-cache space and can mislead.

### Why it stays small

Filtered lessons are **prepended to agent prompts at run start**, inside the stable prefix `[platform | agent spec | volatile task]` that `cache-policy` relies on. Every byte of lessons text is part of the cached prefix on the 5-minute TTL. Bloat here defeats the prompt-cache and inflates `budget-policy` token spend. Keep each lesson to one or two lines. Prune relentlessly.

### Profile filtering

Each lesson is tagged with one or more `profiles` (the canonical ids `fe-rootmfe | fe-childmfe | fe-shared | fe-designsystem | be-experienceapi`). At run start the orchestrator selects **only** the lessons whose `profiles` intersect the run's `profile` (the same value as in the Layer-1 frontmatter) and prepends those. A `fe-childmfe` run never carries `be-experienceapi` lessons, so each profile's cached prefix stays lean.

### Lesson entry format

```markdown
## L-014 — Saye balance shape already lives in eq-one-shared
- profiles: [fe-childmfe, fe-shared]
- agents: ["@mfe", "@state", "@shared-curator"]
- lesson: Balance/holdings stores belong in eq-one-shared; child MFEs import them, never re-declare. dna-precheck must classify these REUSE.
- evidence: runs 2026-05-02-…, 2026-05-19-…, 2026-06-01-…   # 3+ confirmations required
- added_by: subhash.yexaa@gmail.com
- added_at: 2026-06-04
- status: active   # active | retired
```

Fields:
- **`profiles`** — drives the run-start filter. Mandatory.
- **`agents`** — exact roster ids the lesson is most relevant to (advisory; helps humans target pruning).
- **`lesson`** — the imperative one-liner. This is the only part the model needs.
- **`evidence`** — the run_ids that confirmed it. Fewer than three ⇒ reject.
- **`status`** — `retired` lessons are kept for history but never prepended.

---

## Runtime layout (concrete)

The abstract two-layer contract above is materialised at runtime under a single per-run directory. Everything Layer 1 lives in `.eq-sparks/agent-memory/<run-id>/` (a **directory**, not the single `<run-id>.md` file of the original sketch); Layer 2 remains the committed `shared/memory/lessons.md`. The directory is **gitignored** in consumer repos (`path-policy`) and is the unit `/resume` reads.

```
.eq-sparks/agent-memory/<run-id>/
├── scratchpad.md       # Layer-1 per-run working memory: Hypothesis, Investigation log,
│                       #   Decision, Self-eval result, Outcome (the sections above, minus
│                       #   the ledger which is now its own file). Never cached.
├── ledger.jsonl        # Idempotent task ledger — one JSON line per task, appended after EVERY
│                       #   stage (pending→done + content_hash). The resume gate.
├── handoff/            # Agent→agent handoff envelopes, one JSON file per hop:
│   └── <seq>-<from>-to-<to>.json
└── metadata.json       # { run_id, pbi_id, orchestrator, stages, profile, branch, started_at }
                        #   — the run header. Written at Stage 0.
```

The fetched PBI + Figma context does **NOT** live in the run folder. It lives **cross-run** in the single story cache `.eq-sparks/cache/story-cache/<pbi>.json` (per `cache-lookup` / `cache-policy`), keyed by PBI id and located via `metadata.json`'s `pbi_id`. The agent-memory run folder holds only run state — `scratchpad.md`, `ledger.jsonl`, `handoff/`, `metadata.json`. There is no run-folder `ado-context.json` / `figma-context.json`; that competing convention is eliminated.

`metadata.json` carries the run header (`run_id`, `pbi_id`, `orchestrator`, `stages`, `profile`, `branch`, `started_at`); the same validation applies — `run_id` MUST equal the `<run-id>` path segment, `profile` MUST be one of the five canonical profiles, `orchestrator` MUST be an exact orchestrator id, and any owning `agent` id MUST be an exact roster id.

`/resume` replays the **story cache** via `metadata.json`'s `pbi_id` (`.eq-sparks/cache/story-cache/<pbi>.json`), and **NEVER** re-fetches ADO/Figma. There is **no** standalone `self-eval.json`: a worker's `self-evaluate` result is recorded in the scratchpad **Self-eval result** section and carried forward in the `self_eval` field of its handoff envelope (`handoff/<seq>-<from>-to-<to>.json`), so `/resume` sources the last self-eval from the latest envelope, not from a separate file.

The committed starting points for these files live in **`shared/memory/templates/`** (`scratchpad.md`, `ledger.jsonl`, `metadata.json`, and a `handoff/` envelope template). The runtime files under `.eq-sparks/agent-memory/<run-id>/` are instantiated from those templates at run start and are never committed.

### Handoff envelopes

`handoff/<seq>-<from>-to-<to>.json` is how agents **compose**: each agent emits a structured envelope (step 9 of the autoresearch loop) addressed to the next agent or to `@supervisor`, rather than free text. The orchestrator routes it; the receiving agent reads the latest envelope addressed to it. `@supervisor` aggregates all envelopes into the run Summary.

Envelopes are written and read via the **`handoff`** skill, and the schema + routing rules are defined in **`methodology/handoff-protocol.md`**. The envelope shape is:

```json
{
  "run_id": "...", "seq": 3, "from_agent": "@mfe", "to_agent": "@state", "stage": "...",
  "task": "...", "hypothesis": "...",
  "decisions": [{ "fork": "...", "choice": "...", "rationale": "...", "confidence": 0.8 }],
  "artifacts": { "reuse": [], "extend": [], "create": [] },
  "files_touched": [], "diff_summary": "...",
  "self_eval": { "passed": true, "confidence": 0.82, "unmet": [] },
  "open_items": [], "budget": { "tool_calls_used": 17, "remaining": 43 }, "next": "..."
}
```

This is distinct from `/resume` (the cloud→IDE handoff of an entire run); handoff envelopes are intra-run, agent→agent hops.

### Idempotent task ledger

`ledger.jsonl` is the line-oriented form of the Task ledger described above — one JSON line per atomic task, append-only, keyed by a stable `task_id` derived from the task definition (not from time):

```json
{"task_id":"saye-route-wiring","content_hash":"9f3c…","status":"done","agent":"@mfe","ts":"2026-06-13T09:21:04Z"}
{"task_id":"saye-summary-card","content_hash":"4d7e…","status":"pending","agent":"@codegen","ts":"2026-06-13T09:22:10Z"}
```

`status` is one of `done | pending | blocked`:
- **`done`** — work completed (or, for `REUSE` rows, deliberately skipped because the artifact already exists). Never re-executed.
- **`pending`** — not yet attempted, or its `content_hash` changed since the prior run (stale ⇒ re-do). Executed on resume.
- **`blocked`** — surfaced to `@supervisor` for the go/no-go call; not silently skipped.

How it's used:
- **Written incrementally.** The orchestrator (the main thread, which holds `Write`) appends a line to `ledger.jsonl` after **every** stage gate — flipping that stage's `task_id` from `pending` to `done` with its `content_hash` — so an interruption at any stage leaves the completed stages on disk. `@supervisor` specifies *what* to record (task_id, content_hash, status); the orchestrator persists it. The ledger is NOT written only at the final Summary stage.
- **`/resume`** reads `metadata.orchestrator`, loads `ledger.jsonl`, skips every `status: done` line whose `content_hash` still matches the resolved current inputs (a changed hash flips the row back to `pending`), and re-enters that orchestrator's stage sequence at the first `pending` line — picking up exactly where the prior run stopped (cloud→IDE handoff **or** a locally-interrupted run) without re-fetching ADO/Figma.
- **`dedup-policy`** uses the stable `task_id` + `content_hash` to keep the ledger idempotent: an unchanged task always resolves to the same row and is never repeated, while a changed `content_hash` flips the row back to `pending` so it re-executes and never replays stale work. This is the same `REUSE > EXTEND > CREATE` precedence as in the table above — no LLM output, writes, or tests are cached here (see `cache-policy`); the ledger records *whether* work happened, not a result to replay.

---

## Invariants

- **Two layers, one source of truth.** Both paths (autonomous + IDE) read and write the same schema; there is no third memory store and no per-agent private memory.
- **Machines write Layer 1; humans write Layer 2.** No agent ever edits `lessons.md`.
- **Layer 1 is volatile and uncacheable; Layer 2 is stable and cacheable** — this split is exactly what `cache-policy` depends on.
- **The ledger is idempotent.** Stable `task_id` + `content_hash` mean a resume never repeats finished work and never replays stale work.
- **Lessons stay small and proven.** 3+ confirming runs, no speculation, aggressive retirement — to protect the prompt-cache prefix and the token budget.
