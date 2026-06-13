---
description: Threat-review a scope or PR across the EQ FE/BFF estate, fix the findings, and re-verify under governance and budget — the proactive complement to report-driven /fix-pentest.
argument-hint: "[scope | PR number | branch]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, TodoWrite
version: 0.1.0
status: poc
uses_skills: console-render, cache-lookup, dna-precheck, self-evaluate, contract-diff, budget-check, handoff
---

# /security — proactive threat review + fix, governed and re-verified

Turn a **scope, PR, or branch** at `$ARGUMENTS` into adversarially-found, fixed, and
re-verified security remediations across the EQ frontend (EQOne MFEs) and BFF
(ExperienceAPI), under the haiku-first model ladder, the cache, and the run budget.

Where `/fix-pentest` is **report-driven** (it parses an external pentest report and
remediates its findings), `/security` is **proactive**: `@scanner` and `@security` go
looking for the exposure themselves over the named scope, then a build agent fixes and
`@security` re-verifies the finding is actually closed.

This command is the ONLY thread that uses the `Agent` tool — it launches the agents below.
Subagents never launch further subagents. The whole run is fronted by `@supervisor` and
gated by `@critic`; `@decision` resolves any ambiguity (which repo a file belongs to,
whether a finding is FE or BFF, whether a flagged pattern is a real exposure) with a
logged, defensible call.

**Scope under review:** `$ARGUMENTS`

## Operating model (read first)
- **Console.** The run emits the standardised three-part console via the `console-render`
  skill (see `console/CONSOLE-UX.md`): an **Intro card** at the start, one **stage block**
  per stage below, and a **Summary** at the end. Never print ad-hoc output — route it
  through `console-render`.
- **Budget.** `@supervisor` plans the stages and allocates the tool-call/token budget per
  `budget-policy`. The `budget-check` skill is tallied after every stage; if a stage would
  breach the ceiling, `@supervisor` makes the go/no-go call (narrow scope or escalate the
  budget decision) before continuing.
- **Model ladder.** Each agent runs at its default tier (`model-routing-policy`):
  `@scanner` haiku, `@security`/`@critic`/`@decision`/`@architect` opus, `@codegen`/`@db`
  sonnet. Escalate exactly ONE rung only on low self-eval confidence (<0.7) or two `@critic`
  FAILs; escalation is logged and budgeted, never auto-downgraded.
- **Cache.** Read-only scan/threat-locate work is served through `cache-lookup` (keyed
  `skill_id, version, input_hash`, per `cache-policy`) so re-running `/security` on the same
  PR head SHA or unchanged scope never re-pays for the same scan. NEVER cache the fix edits,
  tests, self-eval, the `@security` threat analysis, or any LLM completion.
- **Gate.** `@critic` returns strict PASS/FAIL. A FAIL **blocks the stage** and loops back
  to the owning worker for rework until PASS or the budget says stop.
- **Safety/paths.** Honour `safety-rails` (no secrets in code or logs — reference a secret
  by location, never echo its value; no PII) and `path-policy` (fixes land in the correct
  MFE / `eq-one-shared` / `eq-one-design-system` / BFF `src/domains/<name>/`).
- **Guardrails enforced.** This run exercises the security rails from `guardrails-registry`:
  G4 (no hardcoded secrets), G5 (no PII in logs), G6 (`@scanner` never suppresses
  severity), G8/G9 (no synchronous DB calls / no string-concat SQL — owned by `@db`),
  G10 (no stack traces in API responses), G11 (no endpoints without auth attributes). It
  never bypasses code review (G12) or auto-merges (G1) — `@critic` gates, humans merge.

## Staged flow

### Stage 0 — Plan & budget (Intro card)
`@supervisor` reads `$ARGUMENTS`, resolves it to a concrete scope (a PR/branch diff, a
path/glob, or a whole MFE/BFF domain), plans the stages, allocates the budget per
`budget-policy`, and emits the **Intro card** via `console-render` (target, repos in scope,
budget ceiling). Seeds the `TodoWrite` ledger (one item per finding once found) and opens
the per-run **agent-memory** runtime (`scratchpad.md`, `ledger.jsonl`, `handoff/`,
`metadata.json`) under `.eq-sparks/agent-memory/<run-id>/` per the `memory-schema` runtime
layout (see **Handoff & memory** below). If the scope is vague or ownership is unclear,
`@supervisor` hands the fork to `@decision`, which picks the intended scope (or stops the
run) with a logged rationale.

### Stage 1 — Threat surface (`@scanner` ∥ `@security`, PARALLEL)
Launch `@scanner` (haiku) and `@security` (opus) **concurrently** over the same scope —
they are independent read-only passes, so they run in parallel:
- `@scanner` does the mechanical pass — secret-pattern hits, dependency-vuln diff,
  dead-code, lint — served through `cache-lookup`. Per G6 it **never suppresses or
  downgrades** a vulnerability severity.
- `@security` does the adversarial threat pass — authz on every changed/exposed
  route/endpoint, secret/PII exposure (G4/G5), injection/SSRF surface, stack-trace leakage
  (G10), endpoints missing auth attributes (G11). Its LLM threat analysis is never cached.

Both are read-only and **self-ASSESS** (they produce no diff, so they do NOT run the
diff-based `self-evaluate` — an empty diff must never read as FAIL). Each emits a **handoff
envelope** (secret values MASKED per `safety-rails`) and a **stage block** with findings +
severity + locus + fix direction + self-assessed confidence. The orchestrator merges the
two finding sets (deduping overlaps) into the `TodoWrite` ledger. Where a flagged pattern
is ambiguous (real exposure vs false positive, FE vs BFF, which repo owns it), `@decision`
(opus) makes the defensible call and records the rationale.

### Stage 2 — Fix (`@codegen` / `@db`, PARALLEL across independent findings)
For each confirmed finding, the orchestrator routes the envelope to the owning worker and
applies the surgical fix. **Independent findings on disjoint files/repos are fixed in
parallel**; findings that touch the same file are serialised to avoid edit conflicts:
- FE / general server finding -> `@codegen` (sonnet) for the edit; a frontend specialist
  when one owns the change (e.g. `@contract` for FE↔BFF type drift, `@design-system` to
  replace a hand-rolled component, `@a11y` for accessibility — but those are out of this
  command's core remit unless a finding demands them).
- BFF data-access finding -> `@db` (sonnet) for G8 (synchronous DB calls -> async),
  G9 (string-concat SQL -> parameterised/ORM), connection/transaction/timeout patterns,
  and N+1 fixes; pairs with `@bff-shaper` / `@downstream-connector` when the fix crosses
  a response shape or a downstream call.
Every build agent runs its **autoresearch loop** (`methodology/autoresearch-loop.md`):
`dna-precheck` BEFORE editing (reuse > extend > create; common code moves to
`eq-one-shared` via the `@shared-curator` + `move-to-shared` path), then `self-evaluate`
LAST (confidence <0.7 escalates one rung) and a **handoff envelope** to the re-verify
stage. Emits a **stage block** of the diffs applied. `budget-check` after the stage.

### Stage 3 — `@security` re-verify
Launch `@security` (opus) again to confirm each finding is **actually closed** and that the
fix introduced no new exposure — the same adversarial obligations as Stage 1, now over the
patched code. `@scanner` (haiku, via `cache-lookup`) re-runs the secret/dep/dead-code scans
to prove the vulnerable pattern is gone; `@contract` runs `contract-diff` when a BFF shape
changed so the FE↔BFF boundary stays honest. `@security` self-ASSESSES (read-only) and
emits a **stage block** of verification results per finding: closed vs still-open.
A still-open finding routes the envelope **back** to Stage 2 for the owning worker.

### Stage 4 — Critic gate (`@critic`)
Launch `@critic` (opus) to adversarially review the fixes + re-verification against EQ
standards and the original findings, returning **PASS / FAIL** with required changes. A
**FAIL BLOCKS** the run and routes the handoff envelope **back** to the offending worker
(Stage 2), re-running it (escalating one tier on a second consecutive FAIL per
`model-routing-policy`), then re-verifying, until PASS or `@supervisor` calls stop on
budget. `@critic` self-assesses its gate verdict (no diff). Emits the gate **stage block**.

### Stage 5 — Summary
`@supervisor` makes the final go/no-go, runs `budget-check`, and aggregates the run by
reading **every** handoff envelope under `handoff/*.json` in `seq` order. It emits the
**Summary** via `console-render`: findings resolved vs deferred, severity breakdown, files
changed by repo, code moved to `eq-one-shared` (if any), residual risk, tier escalations,
`@decision` calls, cache hit-rate, and budget consumed vs. ceiling.

## Handoff & memory
Stages **compose** by passing a structured **handoff envelope**, never free text:
- **Routing.** Between stages the orchestrator (this main thread) routes the envelope (the
  `handoff` skill, schema + rules in `methodology/handoff-protocol.md`) from one agent to
  the next — Stage 1's merged findings to the owning workers, each worker's diff to the
  re-verify stage, the re-verify result to `@critic`, `@critic`'s PASS/FAIL to
  `@supervisor`. On a `@critic` FAIL (or a still-open finding at Stage 3) the envelope
  routes **back** to the producing worker (Stage 2) with the required changes in
  `open_items`. Envelopes live at
  `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json`.
- **Memory runtime.** At Stage 0 `@supervisor` opens the per-run **agent-memory** directory
  (`scratchpad.md`, idempotent `ledger.jsonl`, `handoff/`, `metadata.json`) per the
  `memory-schema` runtime layout, and updates the ledger as findings move
  `pending` -> `done`/`blocked`.
- **Loop + self-eval.** Build agents (`@codegen`, `@db`) run the **autoresearch loop**
  (`methodology/autoresearch-loop.md`) and `self-evaluate` LAST; read-only/gate agents
  (`@scanner`, `@security`, `@critic`, `@decision`, `@architect`) **self-ASSESS** (no
  diff-based `self-evaluate`) before emitting their envelope at loop step 9.
- **Aggregation.** At Stage 5 `@supervisor` reads every `handoff/*.json` in `seq` order and
  aggregates them into the **Summary** (`console-render`) — the chain, decisions, artifacts,
  budget, and any open items — reconstructed from on-disk record, not recollection. This
  intra-run, agent->agent handoff is distinct from `/resume` (the cloud->IDE Flow-3 handoff).

## Parallelisation
- **Stage 1 runs `@scanner` ∥ `@security` concurrently** — they are independent read-only
  passes over the same scope (one mechanical, one adversarial), so the orchestrator launches
  both in the same step and merges their finding sets when both return. Each writes its own
  handoff envelope at a distinct `seq`.
- **Stage 2 fans out the fixes in parallel across independent findings** — findings on
  disjoint files/repos are fixed concurrently by `@codegen` and/or `@db`; findings that
  touch the **same file** are serialised to avoid edit conflicts. Each worker runs
  `dna-precheck` first and `self-evaluate` last independently.
- **The `@critic` gate (Stage 4) is the barrier.** All parallel Stage-1 findings and all
  parallel Stage-2 fixes (and their Stage-3 re-verification) must complete and converge
  before `@critic` runs — `@critic` reviews the **aggregated** result once. No fix advances
  past the barrier until `@critic` returns PASS for the whole batch; a FAIL re-opens only the
  offending finding's Stage-2 worker, then the run re-barriers at `@critic`.
- Only this command (the main thread) uses the `Agent` tool; subagents never launch
  subagents, so all fan-out is orchestrated here.

## Steps
1. `@supervisor` parses `$ARGUMENTS`, resolves the scope (PR/branch diff, path/glob, or
   MFE/BFF domain), plans stages + budget (`budget-policy`), seeds the `TodoWrite` ledger,
   opens the **agent-memory** runtime (`memory-schema`), routes any scope ambiguity to
   `@decision`, and emits the **Intro card** (`console-render`).
2. Launch `@scanner` (mechanical, via `cache-lookup`) and `@security` (adversarial threat
   pass) **in parallel** over the scope. Both self-ASSESS. Merge + dedupe their findings
   into the ledger; `@decision` adjudicates any ambiguous/false-positive call.
3. For each confirmed finding, route to the owning worker and fix **in parallel across
   independent findings** (serialise same-file edits): `@codegen` for FE/general,
   `@db` for BFF data-access (G8/G9, connection/timeout, N+1). Each runs `dna-precheck`
   first and `self-evaluate` last. `budget-check` after the stage.
4. `@security` re-verifies each finding is closed (with `@scanner` re-scan and `@contract`
   `contract-diff` where a BFF shape changed); a still-open finding loops back to step 3.
5. Barrier: `@critic` gates the aggregated result PASS/FAIL. On FAIL, loop back to step 3
   for the offending worker (escalate one tier after two FAILs) until PASS or budget stop.
6. `@supervisor` runs final `budget-check`, makes go/no-go, aggregates every
   `handoff/*.json` envelope in `seq` order, and emits the **Summary** (`console-render`).

> Note: only this command (the main thread) uses the **Agent** tool to launch subagents.
> Subagents never launch further subagents.

## Usage
```
/security 4821
```
Threat-review PR #4821: fetch its diff (via `cache-lookup` on head SHA), run `@scanner` ∥
`@security` over the changed surface, fix, re-verify, gate with `@critic`, return the
Summary.

```
/security packages/eq-one-saye-mfe/src/checkout
```
Proactively review a path/glob — the whole checkout flow of the SAYE MFE — for auth,
secret/PII, and injection exposure, then fix and re-verify.

```
/security src/domains/payments
```
Review a BFF ExperienceAPI domain folder — `@db` owns the G8/G9 data-access fixes
(async, parameterised SQL, connection/timeout, N+1) alongside `@security`'s threat pass.

`$ARGUMENTS` is the scope: a PR number, a branch, a path/glob, or an MFE/BFF domain. This
command goes looking for exposure proactively (the complement to report-driven
`/fix-pentest`); if the scope is ambiguous, `@decision` resolves it with a logged,
defensible rationale before any fixing begins.

---

## Resume & checkpoint (interruption-safe)

This orchestrator is resumable after any interruption (IDE closed, crash, cancel). At **Stage 0** the orchestrator writes `.eq-sparks/agent-memory/<run-id>/metadata.json` with `orchestrator: "security"` and the ordered `stages` list, and seeds `ledger.jsonl` with each stage `pending`. After **every** stage passes its gate, the orchestrator — the main thread, which holds `Write`; `@supervisor` is read-only and only specifies *what* to record — **appends a `done` line** to `ledger.jsonl` with that stage's `task_id` + `content_hash` (per [dedup-policy](../shared/guardrails/dedup-policy.md) / [memory-schema](../shared/memory/memory-schema.md)). The ledger is written **incrementally after every stage, not only at the end**, so finished stages survive an interruption. PBI/Figma context is read from the no-TTL **story cache** `.eq-sparks/cache/story-cache/<pbi>.json` and is **never re-fetched**. If interrupted, **`/resume`** reads `metadata.json`, re-enters *this* orchestrator at the first `pending` stage, and skips work already marked `done`.
