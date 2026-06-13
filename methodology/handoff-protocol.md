# Agent → Agent Handoff Protocol

How one eq-sparks agent passes work to the next. Agents do **not** narrate to each other in free text — they exchange a single, structured **handoff envelope** written and read through the [`handoff`](../skills/handoff/SKILL.md) skill and stored under the per-run [agent-memory](../shared/memory/memory-schema.md) runtime. This is the connective tissue of the [autoresearch (A-Rag) loop](./autoresearch-loop.md): an agent finishes its loop at step 9 (EMIT a handoff envelope) and the next agent begins its loop by reading the latest envelope addressed to it.

> This is **agent → agent composition within a single run**. It is *not* the same as `/resume`, the cloud → IDE **Flow 3** handoff — see [Handoff vs `/resume`](#handoff-vs-resume) below.

---

## Why a structured envelope, not free text

Free-text "here's what I did, over to you" notes are unbounded, unparseable, and lossy. eq-sparks runs are governed, budgeted, and resumable, so the contract between agents has to be a small, fixed, machine-readable shape. Four properties drive this:

- **Composability.** The receiving agent needs the *decisions and artifacts*, not the prose. A typed envelope lets `@codegen` consume `@architect`'s placement choices and sub-task plan directly, without re-deriving them. Each agent stays a clean, swappable unit that speaks one protocol.
- **Auditability.** Every fork (`decisions[]`), every file touched, every self-eval result, and every open item is captured in a field a human or `@critic` can read after the fact. The chain of envelopes *is* the run's reasoning trail — nothing material is left in untyped chatter.
- **No-repeat (dedup).** The envelope carries `artifacts.{reuse,extend,create}` straight from `dna-precheck`'s `REUSE > EXTEND > CREATE` classification (see [`dedup-policy`](../shared/guardrails/dedup-policy.md)). The next agent sees what already exists and must not rebuild it. The envelope is how "no repeated code, no dead code, move to shared" travels between stages.
- **Resumability.** The envelope is JSON on disk under `agent-memory`. It survives a stopped run and is replayable. Combined with the idempotent task ledger (see [`memory-schema`](../shared/memory/memory-schema.md)), it lets a later pick-up reconstruct exactly who handed what to whom, with what budget left.

Free text gives none of these. The envelope is deliberately small — it carries the *handoff*, not the artifact; the artifact lives in the repo, and the bulk reasoning lives in the run scratchpad.

---

## The envelope schema

A handoff envelope is one JSON object with this exact shape:

```json
{
  "run_id": "2026-06-13-scaffold-PBI-48213-a7f1",
  "seq": 3,
  "from_agent": "@architect",
  "to_agent": "@codegen",
  "stage": "Generate",
  "task": "Build the saye summary card per AC-2",
  "hypothesis": "the change is a new SummaryCard in eq-one-saye-mfe consuming an existing shared store",
  "decisions": [
    { "fork": "reuse-vs-create balance store", "choice": "REUSE", "rationale": "useBalanceStore already in eq-one-shared", "confidence": 0.9 }
  ],
  "artifacts": {
    "reuse": ["eq-one-shared/src/stores/useBalanceStore.ts"],
    "extend": [],
    "create": ["eq-one-saye-mfe/src/components/SummaryCard.tsx"]
  },
  "files_touched": [],
  "diff_summary": "",
  "self_eval": { "passed": true, "confidence": 0.86, "unmet": [] },
  "open_items": ["confirm card copy against Figma frame"],
  "budget": { "tool_calls_used": 11, "remaining": 49 },
  "next": "@codegen builds SummaryCard, then hands to @critic"
}
```

### Field-by-field

| Field | Type | Meaning |
|---|---|---|
| `run_id` | string | The owning run id. MUST equal the `<run-id>` path segment under `agent-memory` (see [`memory-schema`](../shared/memory/memory-schema.md)). |
| `seq` | integer | Monotonic envelope counter for the run; orders the chain and names the file. |
| `from_agent` | string | The emitting agent — an **exact** id from the 23-agent roster (e.g. `@architect`). |
| `to_agent` | string | The intended recipient — an exact roster id, or `@supervisor` for a gate/aggregate handoff. |
| `stage` | string | The orchestrator stage this handoff closes (e.g. `Preview`, `Generate`, `Review`). |
| `task` | string | One-sentence restatement of the task (the A-Rag loop's step 1 RESTATE), so the receiver inherits scope without re-reading the PBI. |
| `hypothesis` | string | The emitter's "the change is X in file Y" (A-Rag step 4) — what the receiver should validate or build on. |
| `decisions` | array | Forks resolved this stage. Each: `{ fork, choice, rationale, confidence }`. Mirrors any `@decision` rationale so the next agent doesn't re-decide. |
| `artifacts` | object | The `dna-precheck` classification carried forward: `reuse[]`, `extend[]`, `create[]` — real paths. The dedup contract for the receiver. |
| `files_touched` | array | Concrete paths this agent wrote/edited (empty for read-only / planning agents). |
| `diff_summary` | string | Short human summary of the diff produced (empty for read-only agents — never a placeholder). |
| `self_eval` | object | The handing-off agent's self-assessment: `{ passed, confidence, unmet[] }`. For `writesDiff` agents this is the [`self-evaluate`](../skills/self-evaluate/SKILL.md) roll-up; for read-only/gate agents it is the report's self-assessed completeness + confidence (an empty diff must never read as FAIL — see below). |
| `open_items` | array | Loose ends the receiver or `@supervisor` must close. |
| `budget` | object | `{ tool_calls_used, remaining }` from [`budget-check`](../skills/budget-check/SKILL.md) — the receiver and `@supervisor` read this against the [`budget-policy`](../shared/guardrails/budget-policy.md) ceiling. |
| `next` | string | The intended next move — which agent does what — so the orchestrator can route. |

> **`self_eval` and agent kind.** `writesDiff` agents (those that produce edits — `@codegen`, `@mfe`, `@shared-curator`, `@design-system`, `@state`, `@contract`, `@domain-folder`, `@bff-shaper`, `@downstream-connector`, `@contract-publisher`) MUST populate `self_eval` from the diff-based [`self-evaluate`](../skills/self-evaluate/SKILL.md) skill as their mandatory last step. Read-only / gate / planning agents (`@architect`, `@critic`, `@reviewer`, `@security`, `@scanner`, `@perf`, `@a11y`, `@decision`, `@supervisor`, the *-tester gate roles) self-**assess** their report/verdict completeness and confidence instead — they leave `files_touched` and `diff_summary` empty and never run the diff-based skill, because an empty diff must not be scored as FAIL.

---

## Storage and the `handoff` skill

Envelopes live under the gitignored agent-memory runtime for the run:

```
.eq-sparks/agent-memory/<run-id>/
├─ scratchpad.md                              # Layer-1 working memory (hypotheses, log, decisions, self-eval, outcome)
├─ ledger.jsonl                               # idempotent task ledger — {task_id, content_hash, status, agent, ts}
├─ metadata.json                              # { run_id, pbi_id, profile, branch, started_at }
└─ handoff/
   ├─ 0001-supervisor-to-architect.json
   ├─ 0002-architect-to-codegen.json
   └─ 0003-codegen-to-critic.json
```

The handoff file path is exactly:

```
.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json
```

where `<seq>` is the `seq` zero-padded to 4 digits (e.g. `0004`), and `<from>`/`<to>` are the roster ids with the leading `@` dropped for filesystem-safety.

- **Who writes it.** The handing-off agent, as **step 9** of its autoresearch loop, calls the [`handoff`](../skills/handoff/SKILL.md) skill to serialise the envelope and write it to the path above. The envelope is **never cached** (it is per-run, volatile state, like the scratchpad — see [`cache-policy`](../shared/memory/cache-policy.md)).
- **Who reads it.** The receiving agent, as the **first action** of its loop (before RESTATE/SEARCH), calls `handoff` to read the latest envelope addressed to it. It inherits `task`, `hypothesis`, `decisions`, and `artifacts` rather than re-deriving them.
- **Distinct from the scratchpad and ledger.** The envelope is the *point-to-point* message between two agents; the [scratchpad](../shared/memory/memory-schema.md) is each agent's own working memory; the `ledger.jsonl` is the idempotent record of *whether* a task ran (the `/resume` gate). They are complementary, all under the same `<run-id>` folder, all governed by [`memory-schema`](../shared/memory/memory-schema.md).

---

## How the orchestrator routes envelopes

The orchestrator (e.g. `/scaffold`, `/review`) is the **main thread** — only it launches subagents via the `Agent` tool, and subagents never spawn further subagents. It is also the **router** for envelopes between stages:

1. When a stage's agent finishes, it has written its envelope to `handoff/<seq>-<from>-to-<to>.json` (via `handoff`, loop step 9).
2. The orchestrator reads that envelope's `to_agent` and `next`, then launches the named recipient for the next stage, pointing it at the latest envelope addressed to it.
3. The recipient reads that envelope (loop step 1's input) and runs its loop.
4. `@supervisor` gates **between** stages: it reads the closing envelope's `self_eval` and `budget`, runs [`budget-check`](../skills/budget-check/SKILL.md) against the [`budget-policy`](../shared/guardrails/budget-policy.md) ceiling, confirms `path-policy`/`safety-rails`, and gives go/no-go. `@critic` returns `PASS`/`FAIL`; a `FAIL` routes the envelope **back** to the producing `from_agent` (loop back to Generate) rather than forward, escalating one model rung only after two `@critic` FAILs or self-eval confidence `< 0.7` (see [`model-routing-policy`](../shared/guardrails/model-routing-policy.md)).

The agent does not choose its own successor and launch it — it *declares* the successor in `to_agent`/`next`; the orchestrator *routes*. This keeps the single-main-thread invariant intact.

---

## How `@supervisor` aggregates into the Summary

`@supervisor` is the run's governance owner and the **aggregator**. At the final stage it reads **every** envelope under `handoff/*.json` in `seq` order and rolls them up into the Summary that [`console-render`](../skills/console-render/SKILL.md) emits:

- the stage chain (`from_agent → to_agent` per `seq`) and each stage's `@critic` verdict;
- `decisions[]` across the run — the defensible `@decision` rationales, for human review;
- the aggregate `artifacts.{reuse,extend,create}` — proof of the no-repeat / move-to-shared outcome;
- the final `budget` (`tool_calls_used` vs the ceiling) from the last envelope plus `budget-check`;
- any unresolved `open_items` and any `self_eval.unmet` criteria that were waived or carried.

No secrets and no PII appear in the Summary (`safety-rails`). Because the envelopes are the source, the Summary is reconstructed from on-disk record, not from the model's recollection — so it is exact and replayable.

---

## Concrete example chain: `@architect` → `@codegen` → `@critic`

A `/scaffold` run for a saye summary card. Three envelopes, three handoffs.

**`seq` 2 — `@architect` (read-only, planning) → `@codegen`.** `@architect` runs its single design pass, classifies via `dna-precheck`, and emits at `handoff/0002-architect-to-codegen.json`:

```json
{
  "run_id": "2026-06-13-scaffold-PBI-48213-a7f1",
  "seq": 2, "from_agent": "@architect", "to_agent": "@codegen", "stage": "Preview",
  "task": "Build the saye summary card per AC-2",
  "hypothesis": "the change is a new SummaryCard.tsx in eq-one-saye-mfe consuming the shared balance store",
  "decisions": [
    { "fork": "balance store: reuse vs create", "choice": "REUSE", "rationale": "useBalanceStore already in eq-one-shared", "confidence": 0.9 }
  ],
  "artifacts": {
    "reuse": ["eq-one-shared/src/stores/useBalanceStore.ts"],
    "extend": [],
    "create": ["eq-one-saye-mfe/src/components/SummaryCard.tsx"]
  },
  "files_touched": [], "diff_summary": "",
  "self_eval": { "passed": true, "confidence": 0.88, "unmet": [] },
  "open_items": ["confirm card copy against Figma frame node 412:88"],
  "budget": { "tool_calls_used": 9, "remaining": 51 },
  "next": "@codegen builds SummaryCard from the create list; does NOT re-implement the balance store"
}
```

Note `files_touched`/`diff_summary` are empty (read-only agent), and `self_eval` is a self-*assessment*, not a diff grade.

**`seq` 3 — `@codegen` (`writesDiff`) → `@critic`.** `@codegen` reads envelope 2, builds **only** the `create` artifact, imports the `reuse` store (no duplication), runs `self-evaluate` last, and emits at `handoff/0003-codegen-to-critic.json`:

```json
{
  "run_id": "2026-06-13-scaffold-PBI-48213-a7f1",
  "seq": 3, "from_agent": "@codegen", "to_agent": "@critic", "stage": "Generate",
  "task": "Build the saye summary card per AC-2",
  "hypothesis": "SummaryCard renders balance + holdings from useBalanceStore",
  "decisions": [],
  "artifacts": {
    "reuse": ["eq-one-shared/src/stores/useBalanceStore.ts"],
    "extend": [],
    "create": ["eq-one-saye-mfe/src/components/SummaryCard.tsx"]
  },
  "files_touched": ["eq-one-saye-mfe/src/components/SummaryCard.tsx"],
  "diff_summary": "Add SummaryCard.tsx; imports useBalanceStore from eq-one-shared; no new store declared",
  "self_eval": { "passed": true, "confidence": 0.83, "unmet": [] },
  "open_items": [],
  "budget": { "tool_calls_used": 21, "remaining": 39 },
  "next": "@critic gates PASS/FAIL on the diff"
}
```

Here `self_eval` is the diff-based `self-evaluate` roll-up (mandatory last step for a `writesDiff` agent), and `files_touched`/`diff_summary` are populated.

**`seq` 4 — `@critic` (gate) → `@supervisor`.** `@critic` reads envelope 3, reviews the diff, confirms `dna-precheck` + `self-evaluate` ran, and emits at `handoff/0004-critic-to-supervisor.json`:

```json
{
  "run_id": "2026-06-13-scaffold-PBI-48213-a7f1",
  "seq": 4, "from_agent": "@critic", "to_agent": "@supervisor", "stage": "Review",
  "task": "Gate the saye summary card change",
  "hypothesis": "diff is correct, reuses shared store, no dedup or path violation",
  "decisions": [
    { "fork": "PASS or FAIL", "choice": "PASS", "rationale": "no duplication; correct MFE path; store reused per envelope 3", "confidence": 0.85 }
  ],
  "artifacts": { "reuse": [], "extend": [], "create": [] },
  "files_touched": [], "diff_summary": "",
  "self_eval": { "passed": true, "confidence": 0.85, "unmet": [] },
  "open_items": [],
  "budget": { "tool_calls_used": 28, "remaining": 32 },
  "next": "@supervisor go/no-go, then Summary"
}
```

A `FAIL` here would instead set `to_agent: "@codegen"` and route the envelope **back** to `@codegen` with the required changes in `open_items`, blocking the stage. On a `PASS`, `@supervisor` gives go/no-go, and at the end aggregates all four envelopes into the `console-render` Summary.

---

## Handoff vs `/resume`

These are different mechanisms and must not be conflated.

| | Agent → agent handoff (this doc) | `/resume` (Flow 3) |
|---|---|---|
| **Scope** | Between two agents, **within one live run** | Between two *environments* — cloud run → IDE pick-up |
| **Carrier** | A `handoff/*.json` envelope, written/read via the [`handoff`](../skills/handoff/SKILL.md) skill | The whole run folder: `metadata.json`, `scratchpad.md`, the `ledger.jsonl`, and saved `ado-context`/`figma-context` |
| **Trigger** | Every stage boundary, automatically (A-Rag loop step 9) | A developer running [`/resume <run-id>`](../orchestrators/resume.md) to continue a stopped/cloud run locally |
| **Re-fetch?** | N/A — same run, context already in memory | **Never re-fetches ADO/Figma**; replays the saved context |
| **Gate** | The idempotent step in a stage chain | The idempotent *ledger* skips `status: done` tasks and continues from `pending` |

In short: the **handoff envelope** is how stages compose *inside* a run; **`/resume`** is how a run is picked up *across* environments. A resumed run uses the same envelope protocol once it is running again.

---

## Cross-links

- [`memory-schema`](../shared/memory/memory-schema.md) — the agent-memory runtime (`scratchpad.md`, `ledger.jsonl`, `metadata.json`, `handoff/`) that envelopes live in; the idempotent task ledger.
- [`handoff` skill](../skills/handoff/SKILL.md) — the read/write primitive for envelopes.
- [`self-evaluate` skill](../skills/self-evaluate/SKILL.md) — populates `self_eval` for `writesDiff` agents.
- [`budget-check` skill](../skills/budget-check/SKILL.md) / [`budget-policy`](../shared/guardrails/budget-policy.md) — source of the `budget` field and the ceiling it is checked against.
- [`dedup-policy`](../shared/guardrails/dedup-policy.md) — the `REUSE > EXTEND > CREATE` precedence carried in `artifacts`.
- [`autoresearch-loop`](./autoresearch-loop.md) — the loop whose step 9 emits, and step 1 consumes, the envelope.
- [`/resume`](../orchestrators/resume.md) — the distinct cloud → IDE Flow-3 handoff.
