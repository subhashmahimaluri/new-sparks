---
description: Performance orchestrator — profile a scope or PR for bundle/re-render/N+1/downstream fan-out cost, optimise the hotspots in the owning source, re-verify the win, and gate with the governance trio under budget.
argument-hint: "[scope | PR number | branch]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, TodoWrite
version: 0.1.0
status: poc
uses_skills: console-render, cache-lookup, dna-precheck, self-evaluate, contract-diff, budget-check, handoff
---

# /performance — profile, optimise, and re-verify runtime cost, governed

Turn a **scope, PR, or branch** at `$ARGUMENTS` into profiled, optimised, and re-verified
performance wins across the EQ frontend (`eq-nexus-ui` shell + child MFEs `eq-one-saye-mfe`
/ `eq-one-sip-mfe` / `eq-one-shares-mfe` + `eq-one-shared`) and the BFF (`ExperienceAPI`
`src/domains/<name>/`), under the haiku-first model ladder, the cache, and the run budget.

Where `/review` runs performance as **one read-only lens** among six, this command goes the
full distance: `@perf` profiles the four cost-of-runtime smells, the owning worker
**optimises** them, `@perf` **re-verifies** the win is real (and that the change introduced
no regression), and `@critic` gates — looping until clean or budget says stop.

**Scope under profile:** `$ARGUMENTS`

This command is the **main thread**: only it launches subagents via the `Agent` tool.
**Subagents never launch further subagents.** The whole run is fronted by `@supervisor` and
gated by `@critic`; `@decision` resolves any ambiguity (which repo/MFE owns a hotspot,
whether a fan-out fix belongs to `@bff-shaper` or `@downstream-connector`, whether a flagged
smell is a real regression vs a vanity micro-optimisation) with a logged, defensible call.

## Operating model (read first)
- **Console.** The run emits the standardised three-part console via the `console-render`
  skill (see `console/CONSOLE-UX.md`): an **Intro card** at the start, **one block per
  stage** below, and a **Summary** at the end. Never print ad-hoc output — route it through
  `console-render`.
- **Budget.** `@supervisor` plans the stages and allocates the tool-call/token budget per
  `budget-policy`. The `budget-check` skill is tallied after every stage; if a stage would
  breach the ceiling, `@supervisor` narrows remaining work (fewer hotspots per pass, ranked
  by impact) rather than blowing the budget.
- **Model ladder.** Each agent runs at its default tier (`model-routing-policy`): `@perf`
  sonnet (performance reasoning is a specialist judgement call, not mechanical),
  `@critic`/`@decision`/`@architect` opus, `@codegen`/`@db`/`@state`/`@mfe`/`@bff-shaper`/
  `@downstream-connector` sonnet. Escalate exactly **ONE rung** only on low self-eval
  confidence (<0.7) or two `@critic` FAILs; escalation is logged and budgeted, never
  auto-downgraded.
- **Cache.** Read-only profile/scan work (PR diff, repo scans, dep-manifest hash, bundle
  stats, `dna-precheck`) is served through `cache-lookup` (keyed `skill_id, version,
  input_hash`, per `cache-policy`) so re-running `/performance` on the same PR head SHA or
  unchanged scope never re-pays for the same measurement. NEVER cache the optimise edits, the
  re-verify profile, `self-evaluate`, `@critic` verdicts, tests, or any LLM completion.
- **Gate.** `@critic` returns strict PASS/FAIL. A FAIL **blocks the stage** and loops back to
  the owning worker for rework until PASS or the budget says stop.
- **Safety/paths.** Honour `safety-rails` (no secrets in code or logs — reference a secret by
  location, never echo its value; no PII) and `path-policy` (optimisations land only in the
  correct MFE / `eq-one-shared` / BFF `src/domains/<name>/`; never in `eq-one-design-system`
  unless a design-system owner makes the change).
- **Guardrails enforced.** Optimisations must not regress the EQ rails from
  `guardrails-registry`: BFF data-access fixes stay **G8** (no synchronous DB calls — async)
  and **G9** (no string-concat SQL — parameterised/ORM) when `@db` batches an N+1; common
  code lifted while optimising moves to `eq-one-shared` via `@shared-curator` (G15); UI must
  still use `eq-one-design-system`, never hand-rolled (G16); a BFF response-shape change must
  not break the FE↔BFF contract (`@contract` runs `contract-diff`, fail on drift). It never
  bypasses code review (G12) or auto-merges (G1) — `@critic` gates, humans merge.

## Staged flow

### Stage 0 — Plan & budget (Intro card) (`@supervisor`)
`@supervisor` reads `$ARGUMENTS`, resolves it to a concrete scope (a PR/branch diff, a
path/glob, or a whole MFE/BFF domain), plans the stages, allocates the budget per
`budget-policy`, seeds the `TodoWrite` ledger (one item per hotspot once found), and emits
the **Intro card** via `console-render` (target, repos in scope, budget ceiling). Opens the
per-run **agent-memory** runtime (`metadata.json`, `scratchpad.md`, `ledger.jsonl`,
`handoff/`) under `.eq-sparks/agent-memory/<run-id>/` per the `memory-schema` runtime layout
so the run is auditable and resumable. If the scope is vague or ownership is unclear,
`@supervisor` hands the fork to `@decision`, which picks the intended scope (or stops the
run) with a logged rationale.

### Stage 1 — Resolve scope
Resolve `$ARGUMENTS` to a concrete set of changed/target files and owning repos:
- **PR number / branch** → fetch the diff via `gh pr diff` / `git diff` (Bash), routed
  through `cache-lookup` on the head SHA; map each changed path to its MFE / shell /
  `eq-one-shared` / BFF-domain owner.
- **path / glob / MFE / BFF domain** → `Grep`/`Glob` the repos to locate the touched surface,
  served through `cache-lookup`.
If ownership is ambiguous, launch `@decision` for a logged call. Route a **handoff envelope**
carrying the file list + ownership map to `@perf`.

### Stage 2 — Profile (`@perf`)
Launch `@perf` (sonnet, read-only) to profile every in-scope file against the **four
cost-of-runtime smells**:
- **Bundle size** — oversized/duplicated deps, missing code-splitting/lazy boundaries,
  barrel-file bloat in `eq-nexus-ui` and child MFEs.
- **Re-render hotspots** — unstable object/array/function props, missing
  `memo`/`useMemo`/`useCallback`, over-broad Zustand selectors, context churn.
- **N+1 queries** — repeated downstream calls per item in `ExperienceAPI`
  `src/domains/<name>/` instead of batched fetches.
- **Downstream call fan-out** — BFF endpoints fanning out to many downstream APIs serially
  when they could parallelise or be pre-shaped.
Each finding cites `file:line` evidence, a severity (high/medium/low), and a one-line
remediation pointer to the **owning fix agent**. `@perf` runs its **single-shot** loop and
**self-ASSESSES** (it is read-only, produces no diff — it does NOT call the diff-based
`self-evaluate`, so an empty diff never reads as FAIL). Read-only profile/scan work uses
`cache-lookup`; its self-assessment output is never cached. It emits a ranked findings list
as a **handoff envelope** to the optimise stage and a **stage block** of the findings +
self-assessed confidence. The orchestrator loads the findings into the `TodoWrite` ledger.

### Stage 3 — Optimise (PARALLEL across independent hotspots, by owner)
For each confirmed hotspot, the orchestrator routes the envelope to the owning worker and
applies the surgical optimisation. **Independent hotspots on disjoint files/repos are
optimised in parallel**; hotspots that touch the same file are serialised to avoid edit
conflicts:
- **Bundle** (code-split, lazy boundary, dedupe dep, debloat barrel) → `@codegen` (sonnet),
  or `@mfe` (sonnet) when the change touches an MFE boundary/loader.
- **Re-render** (memoisation, prop stability, selector narrowing, context split) →
  `@state` (sonnet) for Zustand selector/store work, else `@codegen` (sonnet).
- **N+1** (batch the per-item downstream calls; keep G8 async + G9 parameterised) →
  `@db` (sonnet) for BFF data-access on `ExperienceAPI` `src/domains/<name>/`.
- **Downstream fan-out** (parallelise serial `await` chains, pre-shape the response) →
  `@downstream-connector` (sonnet) for the client/parallelisation and `@bff-shaper` (sonnet)
  when the fix reshapes the response for the UI.
A BFF response-shape change triggers `@contract` (`contract-diff`) so the FE↔BFF boundary
stays honest (fail on drift). Every build agent runs its **autoresearch loop**
(`methodology/autoresearch-loop.md`): `dna-precheck` BEFORE editing (reuse > extend > create;
common code lifted while optimising moves to `eq-one-shared` via the `@shared-curator` +
`move-to-shared` path, per `dedup-policy`/G15), then `self-evaluate` **LAST** (confidence
<0.7 escalates one rung) and a **handoff envelope** to the re-verify stage. Emits a **stage
block** of the diffs applied. `budget-check` after the stage.

### Stage 4 — Re-verify (`@perf`)
Launch `@perf` (sonnet, read-only) again to **re-profile the optimised surface** and prove
each hotspot is **actually improved** (bundle smaller, the unstable prop/selector gone, the
N+1 batched, the fan-out parallelised) and that the change introduced **no new** cost smell
or regression. Re-profile of unchanged neighbours uses `cache-lookup`; the changed surfaces
are freshly measured (never cached). `@perf` self-ASSESSES (read-only) and emits an updated
PASS/FAIL list as a **handoff envelope** + a **stage block** of the re-verification per
hotspot: improved vs still-hot. A still-hot hotspot routes the envelope **back** to Stage 3
for the owning worker.

### Stage 5 — Critic gate (`@critic`)
Launch `@critic` (opus) to adversarially review the optimisations + re-verification against
EQ standards and the original findings, returning strict **PASS / FAIL** with required
changes. A **FAIL BLOCKS** the run and routes the handoff envelope **back** to the offending
worker (Stage 3), re-running it (escalating one tier on a second consecutive FAIL per
`model-routing-policy`), then re-verifying (Stage 4), until PASS or `@supervisor` calls stop
on budget. `@critic` self-assesses its gate verdict (no diff). Emits the gate **stage block**.

### Stage 6 — Summary (`@supervisor`)
`@supervisor` makes the final go/no-go, runs `budget-check` one final time, and aggregates
the run by reading **every** handoff envelope under `handoff/*.json` (in `seq` order). It
emits the **Summary** via `console-render`: hotspots optimised vs deferred, severity
breakdown, measured win per smell (bundle delta, re-renders removed, N+1 batched, fan-out
parallelised), files changed by repo, code moved to `eq-one-shared` (if any), `@decision`
rationales, tier escalations, cache hit-rate, and budget consumed vs ceiling. The
`agent-memory` ledger is closed for a clean `/resume`.

## Handoff & memory
Stages **compose** by passing a structured **handoff envelope**, never free text:
- **Routing.** Between stages the orchestrator (this main thread) routes the envelope (the
  `handoff` skill, schema + rules in `methodology/handoff-protocol.md`, stored at
  `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json`) from one agent to the
  next — Stage 1's file list + ownership map to `@perf`, `@perf`'s ranked findings to the
  owning workers, each worker's diff to the re-verify stage, the re-verify result to
  `@critic`, `@critic`'s PASS/FAIL to `@supervisor`. On a `@critic` FAIL (or a still-hot
  hotspot at Stage 4) the envelope routes **back** to the producing worker (Stage 3) with the
  required changes in `open_items`.
- **Memory runtime.** At Stage 0 `@supervisor` opens (and through the run updates) the per-run
  agent-memory directory (`metadata.json`, `scratchpad.md`, idempotent `ledger.jsonl`,
  `handoff/`) under `.eq-sparks/agent-memory/<run-id>/` per the `memory-schema` runtime
  layout, instantiated from `shared/memory/templates/`, and moves each hotspot
  `pending` → `done`/`blocked`.
- **Loop + self-eval.** `@perf` runs its **single-shot** loop and **self-ASSESSES** (read-only,
  no diff — not the diff-based `self-evaluate`, so an empty diff never reads as FAIL); the
  optimise workers (`@codegen`, `@mfe`, `@state`, `@db`, `@downstream-connector`,
  `@bff-shaper`) run the **autoresearch loop** (`methodology/autoresearch-loop.md`) with
  `dna-precheck` first and `self-evaluate` **LAST** before emitting their envelope at loop
  step 9. `@critic`/`@decision` self-ASSESS their verdicts.
- **Aggregation.** At Stage 6 `@supervisor` reads every `handoff/*.json` in `seq` order and
  aggregates the chain, decisions, artifacts, measured wins, budget, and any open items into
  the **Summary** (`console-render`) — reconstructed from on-disk record, not recollection.
  This intra-run, agent→agent handoff is distinct from `/resume` (the cloud→IDE Flow-3
  handoff).

## Parallelisation
- **Stage 3 fans out the optimisations in PARALLEL across independent hotspots** — hotspots on
  disjoint files/repos are optimised concurrently by the relevant subset of `@codegen`,
  `@mfe`, `@state`, `@db`, `@downstream-connector`, and `@bff-shaper` (e.g. a bundle code-split
  in the SAYE MFE in parallel with an N+1 batch in a BFF domain). Hotspots that touch the
  **same file**, or where one fix depends on another (e.g. a `@downstream-connector`
  parallelisation that `@bff-shaper` then reshapes, or a shared util lifted to `eq-one-shared`
  that others consume), are **sequenced** by `@supervisor`, not parallelised. Each worker runs
  `dna-precheck` first and `self-evaluate` last independently and writes its own envelope at a
  distinct `seq`.
- **Profile, re-verify, and the gate are SEQUENTIAL barriers.** Stage 2 (`@perf` profile) must
  complete before any optimisation; Stage 4 (`@perf` re-verify) is a **barrier** — all parallel
  Stage 3 optimisations must land before `@perf` re-profiles; and the **`@critic` gate
  (Stage 5) is the barrier** that all re-verified optimisations converge on before the run
  advances to Summary. `@critic` reviews the **aggregated** result once; a FAIL re-opens only
  the offending hotspot's Stage 3 worker, then the run re-barriers at `@perf` re-verify and
  `@critic`.
- Only this command (the main thread) uses the `Agent` tool; subagents never launch subagents,
  so all fan-out is orchestrated here.

## Steps
1. `@supervisor` parses `$ARGUMENTS`, resolves the scope (PR/branch diff, path/glob, or
   MFE/BFF domain), plans stages + budget (`budget-policy`), seeds the `TodoWrite` ledger,
   opens the **agent-memory** runtime (`memory-schema`), routes any scope ambiguity to
   `@decision`, and emits the **Intro card** (`console-render`).
2. Resolve the scope to files + owning repos: `gh pr diff` / `git diff` for a PR/branch (via
   `cache-lookup` on head SHA) or `Grep`/`Glob` for a path/MFE/BFF domain; launch `@decision`
   (`Agent`) for any ambiguous ownership. Hand off the file list + ownership map to `@perf`.
3. Launch `@perf` (`Agent`, read-only) to profile the four smells (bundle / re-render / N+1 /
   downstream fan-out); it self-ASSESSES and emits a ranked PASS/FAIL findings list. Load the
   findings into the ledger. `budget-check` after the stage.
4. For each confirmed hotspot, route to the owning worker and optimise **in PARALLEL across
   independent hotspots** (serialise same-file edits): `@codegen`/`@mfe` (bundle), `@state`/
   `@codegen` (re-render), `@db` (N+1, keeping G8/G9), `@downstream-connector`/`@bff-shaper`
   (fan-out). `@contract` runs `contract-diff` on any BFF shape change. Each runs `dna-precheck`
   first and `self-evaluate` last (lift common code to `eq-one-shared` via `@shared-curator`/
   `move-to-shared`, G15). `budget-check` after the stage.
5. Launch `@perf` (`Agent`) again to **re-verify** each hotspot is improved with no regression
   (barrier: all Stage 4 optimisations must land first); a still-hot hotspot loops back to
   step 4.
6. Barrier: launch `@critic` (`Agent`) for the strict PASS/FAIL gate over the aggregated
   result. On FAIL, loop back to step 4 for the offending worker (escalate one tier after two
   FAILs per `model-routing-policy`), then re-verify; on PASS, continue.
7. Launch `@supervisor` (`Agent`) for the go/no-go verdict; run final `budget-check`; aggregate
   every `handoff/*.json` envelope in `seq` order; emit the **Summary** (`console-render`) with
   the measured wins, and close the `agent-memory` ledger.

> Note: only this command (the main thread) uses the **Agent** tool to launch subagents.
> Subagents never launch further subagents.

## Usage
```
/performance 4821
```
Profile PR #4821: fetch its diff (via `cache-lookup` on head SHA), run `@perf` over the
changed surface for bundle/re-render/N+1/fan-out cost, optimise the hotspots, re-verify the
win, gate with `@critic`, return the Summary.

```
/performance packages/eq-one-saye-mfe/src/dashboard
```
Profile a path/glob — the SAYE MFE dashboard — for bundle bloat and re-render hotspots, then
optimise (`@codegen`/`@mfe`/`@state`) and re-verify.

```
/performance src/domains/payments
```
Profile a BFF `ExperienceAPI` domain folder — `@db` batches any N+1 (keeping G8 async / G9
parameterised) and `@downstream-connector`/`@bff-shaper` parallelise + pre-shape any serial
downstream fan-out, alongside `@perf`'s re-verify.

`$ARGUMENTS` is the scope: a PR number, a branch, a path/glob, or an MFE/BFF domain. This
command profiles cost, optimises the ranked hotspots by impact, and re-verifies the win (the
full-distance complement to the read-only performance lens in `/review`); if the scope is
ambiguous, `@decision` resolves it with a logged, defensible rationale before any optimising
begins.

---

## Resume & checkpoint (interruption-safe)

This orchestrator is resumable after any interruption (IDE closed, crash, cancel). At **Stage 0** the orchestrator writes `.eq-sparks/agent-memory/<run-id>/metadata.json` with `orchestrator: "performance"` and the ordered `stages` list, and seeds `ledger.jsonl` with each stage `pending`. After **every** stage passes its gate, the orchestrator — the main thread, which holds `Write`; `@supervisor` is read-only and only specifies *what* to record — **appends a `done` line** to `ledger.jsonl` with that stage's `task_id` + `content_hash` (per [dedup-policy](../shared/guardrails/dedup-policy.md) / [memory-schema](../shared/memory/memory-schema.md)). The ledger is written **incrementally after every stage, not only at the end**, so finished stages survive an interruption. PBI/Figma context is read from the no-TTL **story cache** `.eq-sparks/cache/story-cache/<pbi>.json` and is **never re-fetched**. If interrupted, **`/resume`** reads `metadata.json`, re-enters *this* orchestrator at the first `pending` stage, and skips work already marked `done`.
