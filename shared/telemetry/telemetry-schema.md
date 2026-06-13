---
id: telemetry-schema
title: Telemetry Schema
version: 1.0.0
status: active
kind: guardrail
layer: agentic-os
category: observability
summary: The telemetry event schema — one JSONL event per action, appended to .eq-sparks/telemetry/<run-id>.jsonl. Defines the event envelope and the fixed set of event types that every agent and skill emits. This stream is the authoritative source for the console "Cache hit" / budget lines, for @infra's cost/health/gate rollup, and for @learner's curated cross-run lessons.
applies_to: all agents, all skills, all orchestrators
owned_by: "@supervisor"
emitted_by: all agents, all skills, all orchestrators
read_by: ["@infra", "@learner", console-render]
related: [memory-schema, cache-policy, budget-policy, model-routing-policy, dedup-policy, path-policy, safety-rails, guardrails-registry]
---

# Telemetry Schema

eq-sparks runs are **metered, governed, and resumable**. Telemetry is the append-only record that makes them **observable** — without it the budget ceiling, the cache hit-rate, the deploy gates, and the cross-run lessons are all invisible. This doc is the single source of truth for **what an event looks like** and **which events exist**.

The rule is simple: **one JSONL event per action.** An agent that reads a sink, a skill that resolves a cache lookup, an orchestrator that crosses a stage boundary, a `@critic` gate that returns a verdict — each appends exactly one line. The stream is never rewritten; it only grows, in time order, for the life of a run.

This is the *observability* layer. It is distinct from — but complementary to — the two memory layers in [`memory-schema`](../memory/memory-schema.md): the Layer-1 scratchpad/ledger records **what work happened** (the resume gate), the handoff envelopes record **what one agent told the next**, and this telemetry stream records **what every action cost and how it went** (the audit + cost trail). The same `run_id` ties all three together.

---

## 1. Sink architecture (works TODAY; NewRelic is pluggable)

Events are written to whichever **sink** is active for the run. There are exactly two, and the local sink is the default:

| Sink | Path / target | When active | Provisioning |
|---|---|---|---|
| **local** (default, authoritative today) | `.eq-sparks/telemetry/<run-id>.jsonl` | Always, unless NewRelic is explicitly enabled | None — works out of the box |
| **newrelic** (pluggable, OFF by default) | NewRelic Logs/Events API | Only when `telemetry.sink: newrelic` **AND** `newrelic.enabled: true` | `account_id` + `license` via ENV / secret store — **NEVER committed** |

Config lives in `.eq-sparks.yml` (see [`.eq-sparks.yml.example`](../../.eq-sparks.yml.example)):

```yaml
telemetry:
  sink: local            # local | newrelic
  newrelic:
    enabled: false       # default OFF — local sink is authoritative until provisioned
    # account_id + license come from ENV / secret store, NEVER from this file
```

`@infra` reads **whichever sink is active** (it resolves NewRelic only when both flags are set, else the local JSONL). **Until NewRelic is provisioned, the local sink is authoritative and nothing blocks** — the platform is fully observable today with zero external dependencies. The wire schema below is **identical** regardless of sink: a NewRelic event is the same envelope, just shipped to a different endpoint.

> **Path discipline.** The local sink lives only under the gitignored `.eq-sparks/telemetry/` runtime ([`path-policy`](../guardrails/path-policy.md)). Agents append events here; they never write telemetry anywhere else, and the directory is never committed.

---

## 2. The event envelope

Every line is a single JSON object. These fields are present on **every** event regardless of type; type-specific fields go under `data` (§4).

```json
{
  "ts": "2026-06-13T09:21:04.117Z",
  "run_id": "2026-06-13-scaffold-PBI-48213-a7f1",
  "pbi_id": 48213,
  "profile": "fe-childmfe",
  "agent": "@codegen",
  "stage": "Generate",
  "event": "skill:invoke",
  "seq": 42,
  "data": { }
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `ts` | string (RFC 3339, UTC, ms precision) | yes | When the action occurred. Time-ordered; the stream is append-only by `ts`. |
| `run_id` | string | yes | The owning run. MUST equal the `<run-id>` segment of the sink path and the `run_id` in [`memory-schema`](../memory/memory-schema.md) / handoff envelopes — this is the join key across telemetry, memory, and console. |
| `pbi_id` | integer \| null | yes | The Azure DevOps work-item id driving the run (`null` for a target-driven run such as `/refactor-shared <domain>` that has no PBI). |
| `profile` | enum | yes | One of the five canonical profiles — `fe-rootmfe \| fe-childmfe \| fe-shared \| fe-designsystem \| be-experienceapi` — so `@learner` can filter cross-run lessons by profile. |
| `agent` | string \| null | yes | The exact roster id emitting the event (e.g. `@codegen`, `@critic`). `null` / the orchestrator id for orchestrator-level events (`run:start`, `agent:transition`). MUST be an exact id from the roster, or `@supervisor` for run-level events. |
| `stage` | string \| null | yes | The orchestrator stage in flight (e.g. `Preview`, `Generate`, `Review`, `Summary`). `null` before the first stage opens. |
| `event` | enum | yes | The event type — one of the fixed set in §3. Drives all downstream parsing. |
| `seq` | integer | yes | Monotonic per-run counter. Orders events that share a `ts` and lets `@infra` detect a dropped/duplicated line. |
| `data` | object | yes | Type-specific payload (may be `{}` for marker-only events). Shapes are defined per type in §4. |

**Invariants**
- **Append-only.** Never edit or delete a line; correction is a new line.
- **Stable-keyed.** `run_id` + `seq` uniquely identify an event.
- **No secrets, no PII** ([`safety-rails`](../guardrails/safety-rails.md)). The NewRelic `account_id`/`license` are NEVER in an event; secret-shaped or PII-shaped values in any `data` slot are masked before the line is written. A leaked credential in telemetry is a breach the same as one in source.
- **Schema-versioned.** A breaking change to this envelope or to a `data` shape bumps this doc's `version`; consumers (`@infra`, `@learner`, `console-render`) key off it.

---

## 3. Event types (the fixed set)

These are the **only** event types. A new type is a schema change (bump `version`).

| `event` | Emitted by | When | Feeds |
|---|---|---|---|
| `run:start` | orchestrator | First action of the run, after `@supervisor` plans the stages and allocates budget | Console **Intro card**; `@infra` run header |
| `run:end` | orchestrator | Last action of the run, after the closing `budget-check` and Summary | Console **Summary**; `@infra`/`@learner` outcome |
| `skill:invoke` | any agent / skill | A skill is called (`dna-precheck`, `contract-diff`, `ado-context`, `figma-context`, `move-to-shared`, `console-render`, `handoff`, …) | `@infra` activity rollup; cost attribution |
| `cache:hit` | `cache-lookup` (per [`cache-policy`](../memory/cache-policy.md)) | A deterministic skill output is served from the per-run cache — work skipped | Console **"Cache hit"** line; `budget-check` savings; `@infra` hit-rate |
| `cache:miss` | `cache-lookup` | A cache lookup found nothing; the skill runs and the result is written back | Console hit/miss counts; `@infra` hit-rate |
| `agent:transition` | orchestrator | Control passes between stages/agents (the orchestrator routes a handoff envelope) | Console **per-stage block**; `@infra` topology/timeline |
| `handoff:emit` | the `handoff` skill | An agent emits its structured handoff envelope (A-Rag loop step 9) | Links telemetry to the `handoff/<seq>-…json` in agent-memory; `@learner` reasoning trail |
| `self-eval:result` | the `self-evaluate` skill (writesDiff agents) **or** a read-only/gate agent's self-ASSESS | An agent records its confidence before handoff | `@infra` escalation signal; the `< 0.7` escalation trigger ([`model-routing-policy`](../guardrails/model-routing-policy.md)) |
| `escalation` | `@supervisor` | A model tier is bumped ONE rung (low confidence, or two `@critic` FAILs) | Console **escalation** line; `cost_cap_usd` attribution; `@infra` churn signal |
| `budget:tick` | `budget-check` | Tallied between stages — running tool-call / token / USD usage vs ceiling | Console **running budget** line; `@infra` burn rate |
| `budget:exceeded` | `budget-check` / `@supervisor` | A budget ceiling is hit or projected to breach (`PAUSE`) | Console budget warning; triggers the `budget-policy` exhaustion sequence |
| `guardrail:violation` | the enforcing agent (per [`guardrails-registry`](../guardrails/guardrails-registry.md)) | A guardrail G1–G15+ is tripped / blocked | Console alert; `@infra` health; `@learner` recurring-violation pattern |

> The set maps directly onto the cost model: `cache:hit`/`cache:miss` are [`cache-policy`](../memory/cache-policy.md); `budget:tick`/`budget:exceeded`/`escalation` are [`budget-policy`](../guardrails/budget-policy.md) + [`model-routing-policy`](../guardrails/model-routing-policy.md); `guardrail:violation` is the [`guardrails-registry`](../guardrails/guardrails-registry.md). The console reads these to render its three parts; nothing in the console is computed from anywhere else.

---

## 4. Per-type `data` shapes

Marker events (`run:start` aside) keep `data` small. These are the documented shapes; consumers tolerate extra keys but rely on these.

```jsonc
// run:start
"data": { "command": "/scaffold", "stages": ["Preview","Plan","Generate","Review","Summary"],
          "budget_ceiling": { "tool_calls": 60, "cost_cap_usd": 2.0, "max_iterations": 5 },
          "tiers_in_use": ["haiku","sonnet","opus"], "sink": "local" }

// run:end
"data": { "outcome": "GO", "iterations": 3,
          "totals": { "tool_calls": 47, "tokens": 91840, "cost_usd": 0.71 },
          "partial_budget": false }     // outcome: GO | NO-GO | BLOCKED | partial-budget

// skill:invoke
"data": { "skill": "dna-precheck", "skill_version": "0.1.0",
          "input_hash": "9f3c…", "cacheable": true, "outcome": "ok", "duration_ms": 412 }

// cache:hit  /  cache:miss
"data": { "skill": "contract-diff", "skill_version": "0.1.0", "input_hash": "b21a…",
          "scope": "per-run", "saved": { "tool_calls": 1, "tokens": 1800 } }   // `saved` only on cache:hit

// agent:transition
"data": { "from_agent": "@architect", "to_agent": "@codegen",
          "stage_from": "Plan", "stage_to": "Generate", "handoff_seq": 3, "parallel_group": null }

// handoff:emit
"data": { "from_agent": "@codegen", "to_agent": "@critic", "handoff_seq": 5,
          "envelope_path": ".eq-sparks/agent-memory/<run-id>/handoff/5-codegen-to-critic.json" }

// self-eval:result
"data": { "kind": "self-evaluate", "passed": true, "confidence": 0.86, "unmet": [] }
          // kind: self-evaluate (writesDiff, diff-based) | self-assess (read-only/gate)

// escalation
"data": { "agent": "@codegen", "from_tier": "sonnet", "to_tier": "opus",
          "reason": "self-eval-confidence<0.7", "iteration": 2 }   // reason: low-confidence | two-critic-fails

// budget:tick
"data": { "tool_calls_used": 41, "tool_calls_ceiling": 60,
          "tokens_used": 86120, "cost_usd": 0.64, "pct_consumed": 0.68, "signal": "OK" }  // signal: OK | WARN | PAUSE

// budget:exceeded
"data": { "budget": "tool_budget", "used": 60, "ceiling": 60, "stage": "Review",
          "action": "PAUSE-and-ask" }   // budget: tool_budget | cost_cap_usd | max_iterations

// guardrail:violation
"data": { "guardrail": "G9", "scope": "@db", "enforcing_agent": "@db",
          "enforcement_point": "code-generation-rule", "blocked": true,
          "detail": "string-concat SQL detected; rewrite parameterised" }
```

`saved` on a `cache:hit` is what the console "Cache hit" line and the PR-body cache summary report (hits, misses, hit-rate, tokens/tool-calls saved). `signal` on `budget:tick` mirrors the `budget-check` verdict. `guardrail` is the exact `Gn` id from the [`guardrails-registry`](../guardrails/guardrails-registry.md) (G1–G14 + the EQ-specific G15+).

---

## 5. Three example lines

Real lines from a `/scaffold` run of `PBI-48213` on the `fe-childmfe` profile (each is one physical line in `.eq-sparks/telemetry/2026-06-13-scaffold-PBI-48213-a7f1.jsonl`):

```jsonl
{"ts":"2026-06-13T09:14:22.004Z","run_id":"2026-06-13-scaffold-PBI-48213-a7f1","pbi_id":48213,"profile":"fe-childmfe","agent":"@supervisor","stage":null,"event":"run:start","seq":1,"data":{"command":"/scaffold","stages":["Preview","Plan","Generate","Review","Summary"],"budget_ceiling":{"tool_calls":60,"cost_cap_usd":2.0,"max_iterations":5},"tiers_in_use":["haiku","sonnet","opus"],"sink":"local"}}
{"ts":"2026-06-13T09:18:47.219Z","run_id":"2026-06-13-scaffold-PBI-48213-a7f1","pbi_id":48213,"profile":"fe-childmfe","agent":"@architect","stage":"Plan","event":"cache:hit","seq":17,"data":{"skill":"contract-diff","skill_version":"0.1.0","input_hash":"b21a8e","scope":"per-run","saved":{"tool_calls":1,"tokens":1800}}}
{"ts":"2026-06-13T09:24:51.882Z","run_id":"2026-06-13-scaffold-PBI-48213-a7f1","pbi_id":48213,"profile":"fe-childmfe","agent":"@db","stage":"Generate","event":"guardrail:violation","seq":58,"data":{"guardrail":"G9","scope":"@db","enforcing_agent":"@db","enforcement_point":"code-generation-rule","blocked":true,"detail":"string-concat SQL detected; rewrite parameterised"}}
```

The first opens the run (Console Intro card). The second is a `contract-diff` cache hit (Console "Cache hit" line; one tool-call and ~1800 tokens saved, tallied by `budget-check`). The third is a blocked G9 string-concat-SQL violation by `@db` (Console alert; `@infra` health; a candidate `@learner` pattern if it recurs across 3+ runs).

---

## 6. Who reads this stream

- **`console-render`** — the orchestrator pre-resolves console fields from these events: `cache:hit`/`cache:miss` → the per-stage **"Cache hit"** counts; `budget:tick` → the **running budget** line; `escalation` → the **tier-escalation** line; `agent:transition` → the **per-stage block**; `run:start`/`run:end` → the **Intro card** / **Summary**. (`console-render` formats — it does not compute; the numbers come from this stream via `budget-check`/`cache-lookup`.)
- **`@infra`** — reads whichever sink is active and rolls up **cost** (`budget:tick`/`escalation`), **health** (`guardrail:violation`, error/timeout rates, escalation churn), and the **G7/G13 deploy-gate readiness** verdict for `@supervisor` and the console. Reports; never deploys.
- **`@learner`** — reads **cross-run** telemetry + outcomes (`run:end`, `self-eval:result`, recurring `guardrail:violation`, repeated `escalation`) alongside the agent-memory handoff envelopes, and **proposes** durable lessons for `shared/memory/lessons.md` once a pattern is confirmed by **3+ runs** — never auto-activating one (**G14**, human approval via PR).

---

## Quick reference

| Question | Answer |
|---|---|
| One event per…? | One action. Append one JSONL line; never rewrite. |
| Where? | `.eq-sparks/telemetry/<run-id>.jsonl` (local, default, authoritative today) or NewRelic when `sink: newrelic` AND `newrelic.enabled: true`. |
| Envelope fields? | `ts, run_id, pbi_id, profile, agent, stage, event, seq, data`. |
| Event types? | `run:start, run:end, skill:invoke, cache:hit, cache:miss, agent:transition, handoff:emit, self-eval:result, escalation, budget:tick, budget:exceeded, guardrail:violation`. |
| Join key? | `run_id` — ties telemetry to `memory-schema` (scratchpad/ledger/handoff) and the console. |
| Never in an event? | Secrets, license keys, PII (`safety-rails`); NewRelic credentials (ENV/secret store only). |
| Who reads it? | `console-render` (the live console), `@infra` (cost/health/gates), `@learner` (cross-run lessons). |
| Add a new event type? | It's a schema change — bump this doc's `version`; consumers key off it. |
