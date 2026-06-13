---
id: parallelization
title: Parallelisation — Fan-out, Serialise, and Barrier
kind: methodology
version: 1.0.0
status: active
owner: "@supervisor"
lineage: "Andrej Karpathy — change as little as possible, prove it; parallelise the independent, never the dependent"
related: [autoresearch-loop, handoff-protocol, README, budget-policy, model-routing-policy, cache-policy, memory-schema, safety-rails]
canonical_for: "every orchestrator's '## Parallelisation' note — when to fan out agents concurrently vs serialise, and where the barriers are"
---

# Parallelisation — Fan-out, Serialise, and Barrier

Most of an eq-sparks run is not on the critical path. A `/review` runs six lenses over the
same diff; a `/scaffold` builds an MFE component, a BFF shape, and FE types that never touch
each other; a `/unit-test` authors a suite per module. Running these one after another wastes
wall-clock the moment they are **independent**. This doc is the canonical rule for **when an
orchestrator fans agents out concurrently, when it serialises, and where the join points
(barriers) are** — the discipline behind every orchestrator's `## Parallelisation` note.

The rule is one sentence, and it is the same Karpathy discipline the
[autoresearch loop](./autoresearch-loop.md) runs on — do the minimum, in the right place, then
prove it — applied to *scheduling* rather than editing:

> **Independent agents run IN PARALLEL; dependent steps serialise; the `@critic` gate and the
> `@supervisor` go/no-go are BARRIERS (join points) that nothing crosses until reached.**

Parallelisation cuts wall-clock **without lowering the quality bar**: the same agents, the same
[autoresearch loop](./autoresearch-loop.md), the same governance trio, the same
[self-evaluate](../skills/self-evaluate/SKILL.md) and [`@critic`](#barriers-the-critic-gate-and-the-supervisor-go-no-go)
gates — only the *ordering* of independent work changes. Nothing skips its self-eval, nothing
skips a gate, no budget rail is relaxed. You get the answer sooner, not a weaker answer.

---

## Who fans out — only the orchestrator

The single-main-thread invariant from the [handoff protocol](./handoff-protocol.md) is the
hard boundary here: **only the orchestrator (the main thread) launches subagents** — via the
`Agent` tool in Claude, or the equivalent Copilot fan-out — and **subagents never spawn further
subagents.** Parallelisation therefore happens at exactly **one** level: the orchestrator
launching N independent workers in a single batch. A worker agent does not parallelise its own
work by spawning helpers; it runs *its* loop. This keeps the run auditable (one router, one
ledger) and keeps the [handoff](../skills/handoff/SKILL.md) envelope graph a clean DAG that
`@supervisor` can aggregate.

Concretely, "launch in parallel" means the orchestrator issues the independent `Agent`
invocations **together, in one step** (one assistant turn / one batch), rather than waiting for
each to return before launching the next. Dependent steps are issued **after** the step they
depend on has returned.

---

## The three scheduling primitives

Every orchestrator stage is exactly one of:

| Primitive | When | Mechanism |
|---|---|---|
| **PARALLEL (fan-out)** | The agents are **independent** — they read/write **disjoint paths**, neither consumes the other's output, and they share no file. | Orchestrator launches them **concurrently** in one batch of `Agent` calls. Each runs its own loop and writes its own [handoff envelope](./handoff-protocol.md) at a distinct `seq`. |
| **SERIAL (sequence)** | One step **depends** on another — it consumes the predecessor's output, or both touch the **same file** (write contention). | Orchestrator launches the dependent step **only after** the predecessor's envelope is on disk. The dependency edge comes from `@architect`/`@supervisor`'s plan. |
| **BARRIER (join)** | A point where parallel work must **fan back in** before the run advances: every `@critic` gate, and every `@supervisor` go/no-go. | Orchestrator **waits for all** in-flight envelopes for the stage to land, then launches the single gate/go-no-go agent over the **aggregate**. |

### How to tell independent from dependent

Use the [`dna-precheck`](../skills/dna-precheck/SKILL.md) / `@architect` placement output as the
authority — it already assigns each artifact a path. Two work-items are **independent** (⇒
parallel) iff:

- their assigned paths are **disjoint** (no shared file → no write contention), **and**
- neither's input is the other's output (no data dependency, e.g. `@contract` aligning to a
  shape `@bff-shaper` is *still changing* is a dependency — serialise it).

Anything else **serialises** on that edge. When in doubt, `@supervisor` serialises — a missed
parallelisation costs wall-clock; a wrong one costs a write conflict or a stale read, which is
worse. Ambiguous ownership (which repo/MFE a file belongs to) is resolved by
`@decision` *before* the fan-out, never raced.

---

## Barriers: the `@critic` gate and the `@supervisor` go/no-go

The two barriers are non-negotiable join points — they are where the quality bar is held while
the schedule is compressed everywhere else:

- **The `@critic` gate is a BARRIER.** All parallel producers for a stage must have written
  their envelopes before `@critic` is launched, because `@critic` gates the **aggregated** work
  as one PASS/FAIL verdict (the `/unit-test` per-module suites, the `/review` six lenses, the
  `/scaffold` build fan-out all converge here). No producer proceeds past its stage until the
  barrier is reached. On **FAIL**, only the **offending** worker re-runs (escalating one rung
  after two FAILs per [`model-routing-policy`](../shared/guardrails/model-routing-policy.md));
  the others' passing envelopes stand, and the run re-hits the barrier and re-gates.
- **The `@supervisor` go/no-go is a BARRIER.** Between stages `@supervisor` reads the closing
  envelopes, runs [`budget-check`](../skills/budget-check/SKILL.md), confirms
  [`path-policy`](../shared/guardrails/path-policy.md)/[`safety-rails`](../shared/guardrails/safety-rails.md),
  and gives go/no-go before the next fan-out is launched. It is also the **aggregator** of every
  parallel branch (see below).

Parallelism lives **between** barriers; it never crosses one.

---

## Worked examples (per orchestrator)

These match each orchestrator's own `## Parallelisation` note — this doc is the shared rule they
all instantiate.

- **`/review` and `/security` run their lenses/passes in PARALLEL.** `/review`'s six lenses
  (`@reviewer` correctness+style, `@security`, `@perf`, `@a11y`, `@contract` via
  [`contract-diff`](../skills/contract-diff/SKILL.md)) are independent read-only passes over the
  **same diff**, so the orchestrator launches them concurrently and merges their finding sets at
  the `@critic` barrier. Likewise `/security` launches `@scanner` ∥ `@security` (one mechanical,
  one adversarial) over the same scope in a single batch, each at a distinct `seq`.
- **`/scaffold` and `/code-builder` fan out independent build specialists in PARALLEL after the
  plan, then BARRIER at `@critic`.** Once `@architect`+`@decision` have produced the placement
  plan with explicit **dependency edges**, the orchestrator fans out the disjoint-path workers
  together — e.g. `@codegen` (core) ∥ `@design-system` (UI) ∥ `@state` (stores) ∥ `@contract`
  (FE types) on the frontend, and `@bff-shaper` ∥ `@downstream-connector` ∥ `@db` on the BFF —
  then **serialises only the dependency edges** (e.g. `@contract-publisher` republishing *after*
  `@bff-shaper`; `@shared-curator`'s move-to-`eq-one-shared` *after* the producers settle). All
  branches fan back in at the `@critic` gate. `/scaffold`'s Stage 2.5 also runs `@scanner` ∥
  `@shared-curator` concurrently over disjoint surfaces.
- **`/unit-test` authors per-module tests in PARALLEL.** The Stage-1 gap map partitions the work
  **by module** (MFE / `eq-one-shared` / BFF domain) into disjoint, co-located test files, so the
  orchestrator launches **one `@tester` per module concurrently**; each authors AND runs its own
  scoped suite/coverage with no write contention. They **barrier at `@critic`**, which gates the
  aggregated tests + coverage as one verdict.
- **`/fix-defect`, `/accessibility`, `/performance` parallelise the fix/optimise step only when
  disjoint.** A single defect usually has one owning worker (serial); a fix that spans
  independent surfaces (a FE `@codegen` edit and a disjoint BFF `@db` data-access fix touching no
  shared file) runs concurrently. `/accessibility` fixes across different components/MFEs fan out
  (`@design-system` ∥ `@codegen`); `/performance` optimises disjoint hotspots concurrently across
  the relevant subset of `@codegen`/`@mfe`/`@state`/`@db`/`@downstream-connector`/`@bff-shaper`.
  In all three, any change to a **shared file** (`eq-one-shared`) is **serialised**, and the
  audit→fix→re-verify→`@critic` shape barriers at the gate.

---

## Budget interaction

Parallel fan-out is a **scheduling** optimisation, **not** a budget discount. Every concurrent
agent's tool/skill calls still count against the **same run `tool_budget`** (default 60, per
[`budget-policy`](../shared/guardrails/budget-policy.md)) — running three agents at once spends
their three slices in parallel, it does not make them free. The implications:

- **`@supervisor` allocates the budget across the fan-out up front**, the same way it slices a
  stage for a single agent — N parallel workers each get a slice of the stage's allocation, and
  the sum still sits under the ceiling. [`budget-check`](../skills/budget-check/SKILL.md) is
  tallied at the barrier, over the **aggregate** of the parallel branches.
- **If the fan-out would breach the ceiling, `@supervisor` narrows it, not the bar** — it runs a
  smaller batch (e.g. `/review`'s `--lenses=` scoping, or the highest-value hotspots first)
  rather than dropping a self-eval or skipping a gate. The [`budget-policy`](../shared/guardrails/budget-policy.md)
  §3 exhaustion sequence still governs: no silent extra pass.
- **Wall-clock falls; total tool spend does not.** Parallelism trades latency for nothing on the
  budget side and nothing on the quality side — the cost stays the sum of the work, the work just
  finishes sooner.

---

## Handoff aggregation across parallel branches

Each parallel agent emits its **own** [handoff envelope](./handoff-protocol.md) at a distinct
`seq` (the monotonic per-run counter keeps them ordered even when they land near-simultaneously).
At the barrier, `@supervisor` is the **aggregator**: it reads **every** `handoff/*.json` envelope
in `seq` order — exactly as for a serial chain — and rolls the parallel branches into one stage
view (combined `files_touched`, the union of `artifacts.{reuse,extend,create}`, each branch's
`self_eval`, all `open_items`) for the `@critic` gate and the final
[`console-render`](../skills/console-render/SKILL.md) Summary. Because the envelopes are
on-disk JSON keyed by `seq` (not in-flight chatter), the aggregation is order-stable and
**replayable**: a fanned-out stage `/resume`s identically to a serial one. The envelope graph is
a DAG — fan-out branches that fan back in at the barrier — and `@supervisor` flattens it in `seq`
order.

---

## Tie to model routing — parallel cheap agents are very cheap

The [Haiku-first ladder](../shared/guardrails/model-routing-policy.md) and parallelisation
compound: because each agent runs at its **default (cheap) tier** and the
[autoresearch loop](./autoresearch-loop.md) does the *thinking* (so cheap models suffice for
most stages), fanning out a batch of Haiku/Sonnet workers is both **fast and cheap** — many
low-cost agents in parallel beat one hot model run serially, on both wall-clock and cost.
Escalation stays exactly as governed: a branch escalates **one rung only** on low self-eval
confidence (`< 0.7`) or two `@critic` FAILs, logged and budgeted, and **only that branch** — a
fan-out does not promote its siblings. The router sees parallel branches as independent
escalation decisions; the schedule never forces a tier change.

---

## Anti-patterns (hard NO)

- **Parallelising dependent steps.** Fanning out agents that share a file or where one consumes
  the other's output → write conflicts and stale reads. Serialise on the dependency edge.
- **Crossing a barrier.** Launching the next stage (or a gate) before all in-flight parallel
  envelopes have landed. The `@critic` gate and `@supervisor` go/no-go gate the **aggregate** —
  partial fan-in is not a join.
- **A subagent fanning out.** Any agent other than the orchestrator launching subagents. Only the
  main thread fans out; subagents never spawn subagents (see [handoff protocol](./handoff-protocol.md)).
- **Treating parallelism as a budget discount.** Assuming concurrent calls are cheaper — they are
  not; they spend the same `tool_budget`, just sooner. Fan-out is narrowed (not the bar lowered)
  when it would breach the ceiling.
- **Lowering the bar for speed.** Skipping a self-eval, a gate, or a re-verify "because it's the
  parallel path". Every branch runs the full loop and its self-eval/self-assess; the gate is
  identical. Parallelism changes ordering, never rigour.
- **Racing ambiguous ownership.** Fanning out before `@decision` has resolved which repo/MFE
  a contested file belongs to — resolve placement first, then fan out the settled work.

---

## Cross-links

- [`autoresearch-loop`](./autoresearch-loop.md) — the per-agent loop each parallel branch runs;
  the Karpathy discipline this doc applies to *scheduling*.
- [`handoff-protocol`](./handoff-protocol.md) — the single-main-thread invariant, the per-branch
  envelopes, and `@supervisor`'s aggregation in `seq` order.
- [`budget-policy`](../shared/guardrails/budget-policy.md) / [`budget-check`](../skills/budget-check/SKILL.md)
  — the shared `tool_budget` parallel branches spend, tallied at the barrier.
- [`model-routing-policy`](../shared/guardrails/model-routing-policy.md) — why parallel cheap
  agents are cheap; per-branch one-rung escalation.
- [`cache-policy`](../shared/memory/cache-policy.md) — read-only parallel scans share the per-run
  cache; never cache the per-branch envelopes, self-eval, tests, or `@critic` verdicts.
- Orchestrators' own `## Parallelisation` notes — the per-command instantiations of this rule
  (`/review`, `/security`, `/scaffold`, `/code-builder`, `/unit-test`, `/fix-defect`,
  `/accessibility`, `/performance`).
</content>
</invoke>
