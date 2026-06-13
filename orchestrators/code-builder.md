---
description: Implement a feature INTO existing EQ FE/BFF code (the day-2 complement to /scaffold's new structure) — ADO-aware, DNA-pre-checked, built by @codegen + specialists in parallel, tested, and gated by the governance trio under budget.
argument-hint: "[PBI id | task description] [skip-figma]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, TodoWrite
version: 0.1.0
status: poc
uses_skills: console-render, ado-context, figma-context, dna-precheck, self-evaluate, cache-lookup, budget-check, handoff
---

# /code-builder — implement a feature into existing code

Turn `$ARGUMENTS` — an Azure DevOps PBI id (e.g. `PBI 51420`) or a free-text task description, optionally followed by `skip-figma` — into a **governed change landed inside code that already exists**. Where `/scaffold` mints *new* structure (a fresh MFE feature, a new `src/domains/<name>/` BFF domain), `/code-builder` is the **day-2 path**: it edits and extends the existing EQOne MFEs (`eq-nexus-ui` shell, `eq-one-saye-mfe` / `eq-one-sip-mfe` / `eq-one-shares-mfe`, `eq-one-shared`, `eq-one-design-system`) and the `ExperienceAPI` BFF (`src/domains/<name>/`) **in place** — reusing first, extending second, creating only when nothing fits.

This command is the **main thread**: only it launches subagents via the `Agent` tool. **Subagents never launch further subagents.** Every stage is planned, budgeted, and gated by the governance trio:

- **@supervisor** owns the run — plans the stages, allocates the tool-call/token budget from `budget-policy`, enforces the guardrails (`safety-rails`, `path-policy`, `dedup-policy`, `cache-policy`), and makes the go/no-go call between stages.
- **@critic** is the strict quality gate — returns `PASS` / `FAIL` per gate. A `FAIL` **blocks** the stage and **loops back to Build** until fixed.
- **@decision** resolves every ambiguity (vague PBI, unclear placement, reuse-vs-extend-vs-create, which MFE/domain owns the change) with a defensible, logged rationale.

The orchestrator emits the standardised three-part console via the **console-render** skill (see `console/CONSOLE-UX.md`): an **Intro card** at the start, **one block per stage**, and a **Summary** at the end. The cost model is enforced throughout — fetch/scan agents and skills read through the cache (`cache-lookup`, honouring `cache-policy`), build agents run **dna-precheck** first and **self-evaluate** last, and **budget-check** is tallied at every stage boundary against the ceiling in `budget-policy`. Agents run at their default model tier and escalate **one rung only** on low self-eval confidence (<0.7) or two critic FAILs — logged and budgeted, never auto-downgraded.

**Target change:** `$ARGUMENTS`

---

## Staged flow

### Stage 0 — INITIATE (`@supervisor`)
`@supervisor` opens the run: emits the **console-render** Intro card (target PBI/task, repos likely in scope, stages queued, budget ceiling), runs a health check (repos reachable, MCP servers up), reads `budget-policy` to set the tool-call/token ceiling, **opens the agent-memory runtime** under `.eq-sparks/agent-memory/<run-id>/` (`metadata.json`, `scratchpad.md`, `ledger.jsonl`, `handoff/` per the `memory-schema` runtime layout, instantiated from `shared/memory/templates/`) and opens the idempotent task ledger so a `/resume` can skip done work, and **warms the cache** (`cache-lookup`, `cache-policy`) for stable PBI metadata and the Anthropic prompt-cache prefix.
- **Agents:** `@supervisor`
- **Skills:** `console-render`, `cache-lookup`, `budget-check`

### Stage 1 — ADO MCP Fetch
Fetch full work-item context for the PBI in `$ARGUMENTS` via the `ado-context` skill (MCP:ado): title, description→markdown, acceptance criteria, tags, parent epic, attachments, and any **Figma URLs** in the description. Result is read through the cache (cross-run cache is opt-in for stable PBI metadata per `cache-policy`). If `$ARGUMENTS` is free text rather than a PBI id, this stage is **AUTO-SKIPPED with reason** ("no PBI id supplied") and the description is taken as the task.
- **Agents:** `@supervisor` (drives the fetch)
- **Skills:** `ado-context`, `cache-lookup`

### Stage 2 — Figma MCP Fetch (conditional)
Runs **IFF** a Figma URL was found in Stage 1 **AND** the `skip-figma` flag is **not** present in `$ARGUMENTS`. Fetches design context via the `figma-context` skill (MCP:figma): frame hierarchy, text, styles, referenced component names, and a render — feeding `@design-system` and `@a11y` downstream when the change touches UI. Otherwise this stage is **AUTO-SKIPPED with reason** (one of: "no Figma URL in PBI" / "skip-figma flag set") rendered in its console block.
- **Agents:** `@supervisor` (drives the fetch)
- **Skills:** `figma-context`, `cache-lookup`

### Stage 2.5 — DNA Pre-Check
Before a single line is changed, run **dna-precheck** across the relevant surfaces — `eq-one-design-system`, `eq-one-shared`, the sibling MFEs (`eq-one-saye-mfe` / `eq-one-sip-mfe` / `eq-one-shares-mfe`), and/or the `ExperienceAPI` `src/domains/*` — to classify every intended artifact as **REUSE / EXTEND / CREATE** (precedence `REUSE > EXTEND > CREATE`, per `dedup-policy`). For a feature landing in *existing* code this stage matters even more than in `/scaffold`: it pins the exact files/symbols to extend and prevents re-implementing something the estate already has. Scans are mechanical and cached.
- **Agents:** `@scanner` (mechanical scan), `@shared-curator` (duplication/dead-code signal)
- **Skills:** `dna-precheck`, `cache-lookup`

### Stage 3 — Plan & locate (`@architect` + `@decision`, gated by `@critic`)
`@architect` (read-only) reads the existing code and proposes a **change plan**: which files/components/hooks/stores/clients in which MFE — and/or which methods/handlers in which `src/domains/<name>/` BFF domain — must be edited or extended, plus the sequence and the dependency edges between the sub-tasks (so Stage 4 knows what can run concurrently). `@decision` takes the dna-precheck output and **records the reuse/extend/create call** for each artifact with a defensible rationale in the run log. `@critic` reviews the plan (`PASS`/`FAIL`); `@supervisor` makes the go/no-go before any write. **Nothing is written until this gate passes.** The plan travels forward as a **handoff envelope** (`handoff` skill) carrying the located edit-sites, the per-task dependency edges, and `artifacts.{reuse,extend,create}`, which `@supervisor` routes to the Stage 4 build agents so they inherit scope without re-deriving it.
- **Agents:** `@architect`, `@decision`, `@critic`, `@supervisor`
- **Skills:** `console-render`, `budget-check`

### Stage 4 — Build (parallel where independent)
Build agents execute the approved plan, honouring `path-policy` (write only where the plan allows) and `dedup-policy` (anything reused **moves to** `eq-one-shared`). Each build agent reads the latest **handoff envelope** addressed to it, runs its **autoresearch loop** (`methodology/autoresearch-loop.md`) with **dna-precheck** at entry (or consumes Stage 2.5's cached result) and **self-evaluate** as the mandatory last step, then emits an envelope (`handoff` skill) to the next agent / `@supervisor` before handing off.
- **General / glue code:** `@codegen` for the core feature edits and anything no specialist owns.
- **Frontend specialists (when the change touches UI):** `@design-system` forces consumption of `eq-one-design-system` (blocks hand-rolled equivalents), `@state` applies EQ Zustand patterns (common stores → `eq-one-shared`), `@contract` aligns FE types/clients to the BFF contract, `@mfe` keeps module-federation boundaries intact, `@shared-curator` moves common code to `eq-one-shared`.
- **BFF specialists (when the change touches a domain):** `@bff-shaper` adjusts request/response shapes for the UI, `@downstream-connector` extends downstream clients with Polly/timeouts/retries, `@db` enforces data-access correctness (async DB calls, parameterised SQL), `@domain-folder` keeps the domain folder a BFF (no business logic), `@contract-publisher` republishes the per-domain OpenAPI/Swagger contract if the shape changed.
- **Skills:** `dna-precheck` (entry), `self-evaluate` (exit), `cache-lookup`

### Stage 5 — Test (`@tester`)
`@tester` authors/updates unit (and where relevant integration) tests for the changed code and runs them. Where the plan produced independent edit-sites, `@tester` writes per-module tests **in parallel** with the same independence the build used. It runs its autoresearch loop, `self-evaluate` last, and emits a handoff envelope. Failing tests route the envelope **back to Stage 4** for the owning build agent to fix.
- **Agents:** `@tester`
- **Skills:** `self-evaluate`, `budget-check`

### Stage 6 — Review & critic gate (`@reviewer` → `@critic`)
`@reviewer` (sonnet) catches the cheap-to-find correctness/style issues first so the opus `@critic` spends budget only on hard calls. `@critic` then returns a strict `PASS` / `FAIL`. **On `FAIL`, loop back to Stage 4 — Build** (or Stage 5 if a test gap) with the required changes; the build agent that owns the artifact escalates one tier only after two critic FAILs (logged + budgeted). `@supervisor` runs `budget-check` and makes the go/no-go.
- **Agents:** `@reviewer`, `@critic`, `@supervisor`
- **Skills:** `budget-check`, `console-render`

### Stage 7 — Summary (`@supervisor` + `@docs`)
`@supervisor` **aggregates every `handoff/*.json` envelope** in `seq` order (per `handoff-protocol`) and emits the **console-render** Summary block: the stage chain, files edited/extended and artifacts reused, where each landed (MFE / shared / design-system / BFF domain), critic verdicts and any loop-backs, `@decision` rationales, escalations, test results, open items, and the final `budget-check` tally vs the `budget-policy` ceiling. `@docs` updates READMEs / JSDoc / XML-doc / changelogs to match the diff. The `agent-memory` ledger is closed for a clean `/resume`.
- **Agents:** `@supervisor`, `@docs`
- **Skills:** `console-render`, `budget-check`

---

## Handoff & memory

The stages above compose through **structured handoff envelopes**, not free text. As each stage's agent finishes, it writes a single JSON envelope via the **`handoff`** skill to `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json` (schema + routing in `methodology/handoff-protocol.md`), declaring its `to_agent`, `decisions`, `artifacts.{reuse,extend,create}`, `self_eval`, `budget`, and `next`. The orchestrator is the **router**: it reads the closing envelope and launches the named recipient for the next stage, pointing it at the latest envelope addressed to it — agents never spawn their own successors.

- **Memory open (Stage 0).** `@supervisor` opens/updates the agent-memory runtime per the `memory-schema` runtime layout (`shared/memory/memory-schema.md`): `metadata.json`, the per-run `scratchpad.md`, the idempotent `ledger.jsonl`, and the `handoff/` envelope dir — all under `.eq-sparks/agent-memory/<run-id>/` (gitignored), instantiated from `shared/memory/templates/`.
- **Per-stage build (Stage 4–5).** Build and test agents run the **autoresearch (A-Rag) loop** (`methodology/autoresearch-loop.md`): they read the inbound envelope (loop step 1's input), investigate through the cache, act surgically, and **self-evaluate** before each handoff — the diff-based `self-evaluate` for `writesDiff` agents, a self-assessment for read-only/gate agents — then emit the outbound envelope (loop step 9).
- **Aggregate (Stage 7).** `@supervisor` reads **every** `handoff/*.json` envelope in `seq` order and rolls the stage chain, decisions, aggregate artifacts, open items, and final budget into the `console-render` Summary, then closes the ledger for a clean `/resume`.

This is intra-run, agent→agent composition — distinct from `/resume` (the cloud→IDE Flow-3 handoff of the whole run), which replays the same ledger and envelopes this command wrote.

---

## Parallelisation

`@architect`'s Stage 3 plan emits explicit **dependency edges** between the located sub-tasks; the orchestrator uses them to fan out Stage 4–5 and barriers at the critic gate.

- **Stage 2.5** runs `@scanner` and `@shared-curator` **concurrently** — independent read-only scans over disjoint surfaces (estate UI vs. duplication/dead-code signal), joined before Stage 3.
- **Stage 4 (Build) fans out the independent edit-sites in parallel.** A typical fan-out: `@codegen` (core feature) ∥ `@design-system` (UI components) ∥ `@state` (stores) ∥ `@contract` (FE types) on the frontend, and `@bff-shaper` ∥ `@downstream-connector` ∥ `@db` on the BFF — each writing to **disjoint paths** the plan assigned it. Agents that share a file, or where one consumes another's output (e.g. `@contract` aligning to a shape `@bff-shaper` is changing, or `@contract-publisher` republishing after `@bff-shaper`), are **serialised on that dependency edge** per the plan; everything else runs concurrently. `@shared-curator`'s "move to `eq-one-shared`" step, if any, runs **after** the producers so it relocates settled code.
- **Stage 5 (Test)** writes per-module tests **in parallel** for independent modules, mirroring the build fan-out.
- **The `@critic` gate (Stage 6) is the barrier.** All parallel Stage 4–5 work must complete and emit its handoff envelopes before `@critic` runs; `@critic` adjudicates the **aggregate** diff once. A FAIL fans back out only to the offending owner(s), then re-barriers at the gate. `@critic` itself is never parallelised. `@supervisor`, `@critic`, and `@decision` are single-threaded governance and never run concurrently with each other.

---

## Steps

1. **Parse `$ARGUMENTS`.** Detect a PBI id vs free-text; detect the `skip-figma` flag. Launch `@supervisor` (Stage 0) to emit the Intro card, run health checks, set the budget from `budget-policy`, open the `agent-memory` ledger (`memory-schema` runtime layout), and warm the cache.
2. **Stage 1 — ADO fetch.** Launch `@supervisor` to run `ado-context` for the PBI; cache the result. Auto-skip with reason if `$ARGUMENTS` is free text.
3. **Stage 2 — Figma fetch.** Only if a Figma URL exists and `skip-figma` is absent, launch `@supervisor` to run `figma-context`; else emit an AUTO-SKIPPED block with the reason.
4. **Stage 2.5 — DNA pre-check.** Launch `@scanner` and `@shared-curator` **in parallel** to run `dna-precheck` across design-system / shared / siblings / BFF domains; classify REUSE/EXTEND/CREATE; join before Stage 3.
5. **Stage 3 — Plan & locate.** Launch `@architect` (locate edit-sites + sub-task sequence + dependency edges) and `@decision` (record reuse/extend/create rationale). Gate with `@critic`; `@supervisor` go/no-go. Do not write until PASS.
6. **Stage 4 — Build.** Launch the relevant build agents **in parallel on the disjoint paths the plan assigned** — `@codegen`, `@design-system`, `@state`, `@contract`, `@mfe`, `@shared-curator`, `@bff-shaper`, `@downstream-connector`, `@db`, `@domain-folder`, `@contract-publisher` — each reading the inbound `handoff` envelope, running its autoresearch loop with `dna-precheck` first and `self-evaluate` last, emitting the next envelope, honouring `path-policy` and `dedup-policy`. Serialise only the agents joined by a dependency edge.
7. **Stage 5 — Test.** Launch `@tester` to author/update + run unit (and relevant integration) tests, in parallel per independent module. Failing tests route back to step 6 for the owning agent.
8. **Stage 6 — Review.** Launch `@reviewer`, then `@critic` for the strict PASS/FAIL **barrier** over the aggregate diff. On FAIL, return to step 6 (or step 7 for a test gap) with required changes (escalate one tier after two FAILs). `@supervisor` runs `budget-check` and gives go/no-go.
9. **Stage 7 — Summary.** Launch `@supervisor` (+ `@docs`) to aggregate all `handoff/*.json` envelopes, emit the `console-render` Summary, final `budget-check`, and close the `agent-memory` ledger.

> Note: only this command (the main thread) uses the **Agent** tool to launch subagents. Subagents never launch further subagents.

---

## Usage

```
/code-builder PBI 51420
```
Fetch ADO work-item 51420, follow any Figma URL it contains, DNA-pre-check across the estate, locate the edit-sites in existing code, then build the feature in place — `@codegen` and the relevant specialists in parallel, tested and governed end to end.

```
/code-builder PBI 51420 skip-figma
```
Same flow, but Stage 2 is AUTO-SKIPPED (`skip-figma flag set`) — useful when the UI is unchanged or the design is unavailable.

```
/code-builder Add a "download statement" button to the existing SIP contributions panel wired to the existing ExperienceAPI sip domain
```
No PBI id, so Stage 1 auto-skips; the description drives the run. `@decision` resolves placement and reuse-vs-extend from the topology and the dna-precheck — extending the existing panel and domain rather than scaffolding new structure.

```
/code-builder PBI 52007 skip-figma
```
BFF-leaning change into existing code: `@db` and `@downstream-connector` extend data access on `src/domains/<name>/` in parallel, `@bff-shaper` adjusts the response shape, `@contract-publisher` republishes the contract, and `@contract` aligns FE types — serialised only on the shape dependency edge.

> For *new* structure (a fresh MFE feature or a new `src/domains/<name>/` BFF domain) use **/scaffold**; for continuing a prior run without re-fetching ADO/Figma use **/resume** (it reads the `agent-memory` ledger this command wrote).
