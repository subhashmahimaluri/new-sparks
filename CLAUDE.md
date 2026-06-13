# CLAUDE.md — eq-sparks master architecture & operating guide

> This is the single most important document in the repo. Claude Code loads it every session, and every developer on the EQ frontend + BFF estate reads it first. If you only read one file, read this one.

---

## 1. What eq-sparks IS

**eq-sparks is a central agentic harness for the Equiniti (EQ) frontend + BFF estate.** One repo — this one — holds every **agent**, every **orchestrator** (slash command), every **skill**, every **guardrail**, and the hidden **"agentic OS"** (cache, budget, memory). It is the single source of truth for how AI does work across all the EQOne MFEs and the ExperienceAPI BFF.

The harness is authored here once and **synced into every consumer repo** by a sparse-checkout install. In a consumer repo the machinery lands behind a **gitignored `.eq-sparks/` folder** — developers never see it. What they *do* see, committed and reviewable, are clean **agents + orchestrators** rendered into the IDE's native format: `.claude/` for Claude Code today, `.github/` for Copilot as a fast-follow. The same agent source renders to both, so the two IDEs never drift.

The shape of it:

- **One source of truth** — agents, skills, guardrails, profiles live here and nowhere else. Fix a bug in `@critic` once, every repo gets it on the next sync.
- **Hidden OS, visible agents** — the noisy internals (cache, budget ledger, run memory, telemetry) stay out of sight and out of version control; the readable agents and orchestrators are surfaced into `.claude/`.
- **Cost-first by design** — the whole point is strong, governed output **under budget**, even when leaning on the cheap Haiku model (see [§3](#3-the-operating-model-for-cost)).

For this POC, **Claude Code format is canonical and runnable now.** The Copilot `.github/` render is produced by the adapter as a fast-follow ([§9](#9-ide-rendering-status)).

The why and the full delivery model are in [EQ-SPARKS-POC-PLAN.md](EQ-SPARKS-POC-PLAN.md).

---

## 2. Repository topology & the estate rules

Every agent must know the estate it operates on. Two halves: the EQOne frontend, and the ExperienceAPI BFF.

### Canonical source layout (the source of truth)

The visible top-level layout below is **canonical** — author here and nowhere else:

```
eq-sparks (CENTRAL — this repo)
  agents/<layer>/<id>.md     26 sub-agents, layer ∈ {governance, core, frontend, bff, platform}
  skills/<id>/SKILL.md       skills (incl. the handoff skill)
  orchestrators/<id>.md      orchestrators (slash commands)
  methodology/               execution methodology (autoresearch-loop.md, handoff-protocol.md, parallelization.md, README.md)
  shared/guardrails/         guardrails-registry / budget / model-routing / dedup / safety / path policies
  shared/memory/ (+ templates/)  cache-policy, memory-schema, lessons, run-memory templates
  shared/telemetry/          telemetry schema + sinks (local JSONL default, NewRelic pluggable)
  shared/integrations/       ADO + Figma MCP integration notes
  console/, instructions/, profiles/   visible support
  bin/render-claude.mjs      the render: canonical source → .claude/
  bin/render-copilot.mjs     the render: canonical source → .github/ (Copilot)
  .claude/, .github/         GENERATED — never hand-edit (see below)
```

**`.claude/` is generated, not authored.** `bin/render-claude.mjs` renders the canonical `agents/`, `skills/`, and `orchestrators/` sources into Claude Code's native `.claude/` tree (`.claude/agents/`, `.claude/skills/`, `.claude/commands/`). **Never hand-edit anything under `.claude/`** — edit the canonical source above, then re-render (`node bin/render-claude.mjs`). The Copilot `.github/` render is a fast-follow from the same source ([§9](#9-ide-rendering-status)).

### The estate the agents operate on

```
eq-sparks (CENTRAL — this repo)  →  sync  →  consumer repos behind .eq-sparks/
                                              renders clean agents to .claude/ (and .github/ later)

FRONTEND (EQOne)                              BFF
  eq-nexus-ui        RootMFE / shell          ExperienceAPI (C#/ASP.NET monorepo)
  eq-one-saye-mfe    child MFE                  src/domains/saye/    independently deployable
  eq-one-sip-mfe     child MFE                  src/domains/sip/     independently deployable
  eq-one-shares-mfe  child MFE                  src/domains/shares/  independently deployable
  eq-one-shared      home for common code
  eq-one-design-system  facade over eq-one-studio Storybook
```

### Frontend rules (non-negotiable — agents enforce these)

- **`eq-nexus-ui` is the RootMFE / shell.** It owns routing, module wiring, and the cross-MFE contracts. Child MFEs plug into it; they don't reach around it.
- **Child MFEs (`eq-one-saye-mfe`, `eq-one-sip-mfe`, `eq-one-shares-mfe`) are independent and MUST NOT duplicate code.** If two MFEs need the same thing, it doesn't live in two places.
- **`eq-one-shared` is the home for common code** — layout, auth, common API clients, common Zustand stores. Anything reused **moves here**. This is enforced before generation by the DNA pre-check and after by [`@shared-curator`](agents/frontend/shared-curator.md).
- **`eq-one-design-system` is a facade over `eq-one-studio` Storybook.** UI **consumes components from the design system — it NEVER hand-rolls** what the design system already provides. [`@design-system`](agents/frontend/design-system.md) blocks hand-rolled equivalents.

### BFF rules (ExperienceAPI)

- **One C#/ASP.NET monorepo**, with **one independently-deployable folder per domain** at `src/domains/<name>/`.
- Each domain **connects downstream APIs** and **"paints & polishes" request/response shapes** for the UI. It is a **BFF, not business logic** — no domain logic leaks in here.
- The FE consumes the BFF's **API contracts**. [`@contract-publisher`](agents/bff/contract-publisher.md) publishes them; the FE [`@contract`](agents/frontend/contract.md) agent stays aligned and fails on drift.

---

## 3. The operating model for cost

This is the whole point of eq-sparks: **20–50 developers getting strong, governed output cheaply — even on Haiku.** It rests on three pillars, each with a guardrail doc. Read them; they are the law.

### Pillar 1 — Haiku-first model-routing ladder

See [model-routing-policy](shared/guardrails/model-routing-policy.md).

Every agent declares a **default tier** in its frontmatter, chosen to be the cheapest model that can do the job well:

- **HAIKU** — mechanical / rule-based work: [`@tester`](agents/core/tester.md), [`@scanner`](agents/core/scanner.md), [`@docs`](agents/core/docs.md), [`@a11y`](agents/frontend/a11y.md).
- **SONNET** — code generation and the specialists: [`@codegen`](agents/core/codegen.md), [`@reviewer`](agents/core/reviewer.md), the FE and BFF specialists, the integration/contract testers, [`@perf`](agents/core/perf.md).
- **OPUS** — judgment only, invoked sparingly (typically once per stage): the governance trio ([`@supervisor`](agents/governance/supervisor.md), [`@decision`](agents/governance/decision.md), [`@critic`](agents/governance/critic.md)), plus [`@architect`](agents/core/architect.md) and [`@security`](agents/core/security.md).

**Escalation is one rung only**, and only on a real signal: a self-eval **confidence below 0.7**, or **two [`@critic`](agents/governance/critic.md) FAILs** on the same output. Every escalation is **logged and budgeted**. There is **never an automatic downgrade** — quality is sticky.

### Pillar 2 — Budget ceiling

See [budget-policy](shared/guardrails/budget-policy.md).

Each run has a **tool-call ceiling and token tracking**, enforced by [`@supervisor`](agents/governance/supervisor.md) via the [budget-check](skills/budget-check/SKILL.md) skill. If a run would breach the ceiling, it **pauses and asks** rather than burning budget silently. Cost and tool-calls used are surfaced in every Summary.

### Pillar 3 — Cache layers

See [cache-policy](shared/memory/cache-policy.md). Driven by the [cache-lookup](skills/cache-lookup/SKILL.md) skill.

Two complementary caches:

- **Per-run skill-output cache**, keyed `(skill_id, version, input_hash)`. This is what produces the "Cache hit" line on an ADO/Figma fetch. **NEVER cache writes, tests, self-eval, or LLM completions.** There is an **opt-in cross-run cache** for stable PBI metadata only.
- **Anthropic prompt-cache alignment** — agents are assembled with a **stable prefix** in the order `[platform | agent spec | volatile task]` so the platform and agent-spec portions hit Anthropic's prompt cache on a **5-minute TTL**. The volatile task goes last so it never invalidates the stable prefix.

### Pillar 3+1 — No-repeat / dedup

See [dedup-policy](shared/guardrails/dedup-policy.md).

Two mechanisms keep the platform from doing the same work twice:

- **DNA pre-check** — before any code is generated, the [dna-precheck](skills/dna-precheck/SKILL.md) skill scans the relevant repos and classifies the work as **reuse / extend / create**. Precedence is strict: **REUSE > EXTEND > CREATE**. Common code moves to `eq-one-shared`.
- **Idempotent task ledger** — held in agent-memory (see [memory-schema](shared/memory/memory-schema.md)). A resumed run reads the ledger and **skips work already done**, so `/resume` never redoes a completed stage.

> Net effect: the cheap model does most of the work, the cache kills repeated fetches, the dedup check kills repeated generation, and the budget ceiling keeps the lid on. That is how the estate stays affordable at 20–50 developers.

---

## 4. The agent roster (26 agents)

Agents are grouped into five layers (the `agents/<layer>/` folders: `governance`, `core`, `frontend`, `bff`, `platform`). Each carries a **default model tier** (the cost lever) and escalates one rung only on the trigger in [§3](#3-the-operating-model-for-cost). Build agents run [dna-precheck](skills/dna-precheck/SKILL.md) first and [self-evaluate](skills/self-evaluate/SKILL.md) last; every agent runs the [autoresearch (A-Rag) loop](#10-execution-methodology) and emits a [handoff](skills/handoff/SKILL.md) envelope to the next agent. Read-only / gate agents self-*assess* in place of the diff-based `self-evaluate`.

### Governance (tier=opus) — runs on every orchestrator

| Agent | Tier | Role |
|---|---|---|
| [`@supervisor`](agents/governance/supervisor.md) | opus | Owns the run: plans the stages, allocates the tool-call/token budget, enforces guardrails, makes the go/no-go call between stages, aggregates the final Summary. Nothing proceeds without it. |
| [`@decision`](agents/governance/decision.md) | opus | Resolves ambiguity at every fork (vague PBI, missing contract, unclear placement, reuse-vs-create) with a **defensible, logged** call for human review. |
| [`@critic`](agents/governance/critic.md) | opus | Adversarial reviewer. Returns **PASS / FAIL** with required changes against EQ standards. A FAIL **blocks** the stage. Deliberately strict — the quality gate, not a cheerleader. |

### Core — build / test / quality

| Agent | Tier | Role |
|---|---|---|
| [`@architect`](agents/core/architect.md) | opus | System/design decisions and decomposition: where code belongs, the shape of the change, the sub-task sequence. Read-only — designs, never builds. |
| [`@codegen`](agents/core/codegen.md) | sonnet | General-purpose, language-agnostic code generation and surgical edits when no specialist owns the change. |
| [`@reviewer`](agents/core/reviewer.md) | sonnet | Standard code review for correctness, style, EQ conventions — runs before `@critic` so opus budget is spent only on hard calls. |
| [`@tester`](agents/core/tester.md) | haiku | Writes and runs unit tests, reads results. Mechanical, well-scoped. |
| [`@integration-tester`](agents/core/integration-tester.md) | sonnet | Authors cross-module / cross-MFE integration tests. |
| [`@contract-tester`](agents/core/contract-tester.md) | sonnet | Authors contract tests that pin the FE↔BFF boundary and fail on drift. |
| [`@security`](agents/core/security.md) | opus | Threat reasoning: authz on every route/endpoint, no secrets, no PII in logs, injection/SSRF surfaces. |
| [`@scanner`](agents/core/scanner.md) | haiku | Mechanical scans: dependency diffs, dead-code detection, secret-pattern regex, lint output. |
| [`@docs`](agents/core/docs.md) | haiku | Updates READMEs, JSDoc/XML-doc, changelogs to match the diff. |
| [`@perf`](agents/core/perf.md) | sonnet | Performance review: bundle size, re-render hotspots, N+1 queries, downstream call fan-out. |

### Frontend (EQOne) specialists

| Agent | Tier | Role |
|---|---|---|
| [`@mfe`](agents/frontend/mfe.md) | sonnet | Scaffolds/extends a child MFE and wires it into the `eq-nexus-ui` RootMFE shell, respecting MFE boundaries and the module-federation contract. |
| [`@shared-curator`](agents/frontend/shared-curator.md) | sonnet | Detects duplicated/common code across MFEs and **moves it to `eq-one-shared`**; flags dead code. The enforcer of "no repeat code / move to shared". |
| [`@design-system`](agents/frontend/design-system.md) | sonnet | Forces UI to consume `eq-one-design-system` components (facade over `eq-one-studio` Storybook); **blocks hand-rolled equivalents**. |
| [`@state`](agents/frontend/state.md) | sonnet | Applies EQ Zustand store patterns; common stores go to `eq-one-shared`. |
| [`@contract`](agents/frontend/contract.md) | sonnet | Keeps FE types/clients aligned to the ExperienceAPI BFF contract; **fails on drift**. |
| [`@a11y`](agents/frontend/a11y.md) | haiku | Checks every screen against WCAG 2.2 AA (aria, focus order, contrast, keyboard nav). |

### BFF (ExperienceAPI) specialists

| Agent | Tier | Role |
|---|---|---|
| [`@domain-folder`](agents/bff/domain-folder.md) | sonnet | Scaffolds a new, independently-deployable domain folder at `src/domains/<name>/`. |
| [`@bff-shaper`](agents/bff/bff-shaper.md) | sonnet | "Paints & polishes" request/response shapes downstream→UI so the FE gets exactly the shape it needs. |
| [`@downstream-connector`](agents/bff/downstream-connector.md) | sonnet | Wires downstream API clients with resilience (Polly), timeouts, retries. |
| [`@contract-publisher`](agents/bff/contract-publisher.md) | sonnet | Publishes the per-domain API contract (OpenAPI/Swagger) that the FE `@contract` agent consumes. |

### Platform — infra / data / learning

| Agent | Tier | Role |
|---|---|---|
| [`@infra`](agents/platform/infra.md) | sonnet | Read-only. Reads infrastructure + the active **observability** sink ([§12](#12-observability)), enforces deploy/quality gates **G7 + G13**, and surfaces run telemetry / cost / health to [`@supervisor`](agents/governance/supervisor.md) and the console. **Reports — never deploys.** Self-assesses (no diff self-evaluate). |
| [`@db`](agents/platform/db.md) | sonnet | Data-access correctness on the ExperienceAPI BFF: enforces **G8** (async — no synchronous DB calls), **G9** (parameterised/ORM — no string-concat SQL), connection/transaction/timeout patterns, no N+1. Pairs with [`@downstream-connector`](agents/bff/downstream-connector.md) / [`@bff-shaper`](agents/bff/bff-shaper.md). Runs dna-precheck first, self-evaluate last. |
| [`@learner`](agents/platform/learner.md) | sonnet | Read-only **curated-learning** loop: reads cross-run telemetry + outcomes and **proposes** durable lessons for [shared/memory/lessons.md](shared/memory/lessons.md), but **never auto-activates** a rule/lesson — **G14**: human approval via PR. Proposes; humans merge. Self-assesses. |

### The governance flow

```
@supervisor plans the stages + budget
      → worker agents produce (DNA pre-check first, self-evaluate last)
            → @critic returns strict PASS / FAIL   (FAIL blocks the stage until fixed)
                  → @supervisor makes the go / no-go call

@decision is consulted at any fork to make a defensible, logged choice.
```

Nothing reaches a developer until [`@critic`](agents/governance/critic.md) PASSes and [`@supervisor`](agents/governance/supervisor.md) says GO.

---

## 5. Orchestrators (slash commands)

Orchestrators are the **only** things that launch subagents (subagents never spawn further subagents). Each is authored canonically at `orchestrators/<id>.md` (rendered to `.claude/commands/<id>.md`) and runs the governance trio across its stages.

| Command | Purpose |
|---|---|
| [`/scaffold`](orchestrators/scaffold.md) | **Flagship.** Turn an ADO PBI into a cross-repo-aware, governed scaffold: ADO fetch → conditional Figma fetch → DNA pre-check → preview → generate → review. |
| [`/review`](orchestrators/review.md) | Fetch the diff, run a 6-lens review, gate with the governance trio. |
| [`/fix-pentest`](orchestrators/fix-pentest.md) | Parse pentest findings, locate them in FE/BFF, fix, and re-verify. |
| [`/contract-sync`](orchestrators/contract-sync.md) | Sync FE types to the latest ExperienceAPI BFF contract for a domain. |
| [`/refactor-shared`](orchestrators/refactor-shared.md) | Find duplicated/common code and move it into `eq-one-shared`. |
| [`/resume`](orchestrators/resume.md) | Resume a prior run (Flow 3 cloud→IDE handoff) **without** re-fetching ADO/Figma. |
| [`/code-builder`](orchestrators/code-builder.md) | Implement a feature into **existing** code (vs `/scaffold` = new structure): plan → ADO/DNA → `@architect`+`@decision` → `@codegen` + specialists (parallel) → `@tester` → `@reviewer`→`@critic`. |
| [`/fix-defect`](orchestrators/fix-defect.md) | Diagnose + fix a defect from a PBI / bug id / stack trace: reproduce & locate (`@scanner`+`@codegen`) → root-cause → fix (`@codegen`/`@db`) → regression tests → `@critic`. |
| [`/unit-test`](orchestrators/unit-test.md) | Author/run unit tests to a coverage target: `@scanner` finds untested code → `@tester` authors tests (parallel per module) → run + coverage → `@critic`. |
| [`/accessibility`](orchestrators/accessibility.md) | WCAG 2.2 AA audit + fix for a screen/route/PR: fetch (+figma-context) → `@a11y` audit → fix (`@design-system`/`@codegen`) → `@a11y` re-verify → `@critic`. |
| [`/security`](orchestrators/security.md) | Threat review + fix (complements report-driven `/fix-pentest`): `@scanner`+`@security` (parallel) → fix (`@codegen`/`@db`) → `@security` re-verify → `@critic`. |
| [`/performance`](orchestrators/performance.md) | Perf audit + optimise: `@perf` profile (bundle/render/N+1/downstream fan-out) → optimise (`@codegen`/`@db`/`@downstream-connector`) → `@perf` re-verify → `@critic`. |

**Every orchestrator emits the same standardised console** — an Intro card, a per-stage block, and a Summary — via the [console-render](skills/console-render/SKILL.md) skill. Only the stage list and agent roster change between commands. The full contract is in [console/CONSOLE-UX.md](console/CONSOLE-UX.md).

---

## 6. Profiles

A repo installs eq-sparks by **choosing a profile + IDE**. The profile decides which agents/skills/rules render into that repo; the governance trio is always included. Five profiles map repo types to agent sets:

| Profile | For repo | Pulls in (besides governance trio) |
|---|---|---|
| `fe-rootmfe` | eq-nexus-ui | `@mfe`, `@design-system`, `@contract`, routing/shell rules |
| `fe-childmfe` | saye / sip / shares MFE | `@mfe`, `@state`, `@design-system`, `@contract`, `@a11y` |
| `fe-shared` | eq-one-shared | `@shared-curator`, `@state`, common-code rules |
| `fe-designsystem` | eq-one-design-system | `@design-system`, Storybook facade rules |
| `be-experienceapi` | ExperienceAPI | `@domain-folder`, `@bff-shaper`, `@downstream-connector`, `@contract-publisher` |

Same agent source → multiple profiles → multiple IDE formats. Full definitions and the coarse-to-fine roadmap are in [profiles/README.md](profiles/README.md).

---

## 7. How to author / extend

The authoring contract — frontmatter keys, id rules, the cost-model bake-in — is in [SCHEMA.md](SCHEMA.md). Read it before adding anything.

**The golden rule: agents live once in the canonical top-level layout ([§2](#2-repository-topology--the-estate-rules)) and render to `.claude/` (and later `.github/`).** Author in the canonical location; never hand-edit a rendered `.claude/` file — `bin/render-claude.mjs` overwrites it. **After editing any canonical source, run `node bin/render-claude.mjs`** to regenerate `.claude/`.

- **Add an agent:** create `agents/<layer>/<id>.md` (layer ∈ `governance`, `core`, `frontend`, `bff`, `platform`) with frontmatter (`name`, `description`, `model`, `tools`, `loop` (`autoresearch` or `single-shot`), plus optional canonical keys). State its **default tier** and **escalation trigger**. Build agents must run [dna-precheck](skills/dna-precheck/SKILL.md) first and [self-evaluate](skills/self-evaluate/SKILL.md) last, and emit a [handoff](skills/handoff/SKILL.md) envelope. Reference other artifacts by their **exact id**.
- **Add a skill:** create `skills/<id>/SKILL.md`. Mark `cacheable` only where [cache-policy](shared/memory/cache-policy.md) allows it (never for writes/tests/self-eval/completions).
- **Add an orchestrator:** create `orchestrators/<id>.md` with `allowed-tools` including `Agent`, use `$ARGUMENTS`, and reuse the [console-render](skills/console-render/SKILL.md) console.
- **Re-render:** after any of the above, run `node bin/render-claude.mjs` so the `.claude/` tree matches the canonical source. Never commit hand-edits to `.claude/`.

Honour the guardrail ids when cross-referencing: [guardrails-registry](shared/guardrails/guardrails-registry.md), [budget-policy](shared/guardrails/budget-policy.md), [model-routing-policy](shared/guardrails/model-routing-policy.md), [dedup-policy](shared/guardrails/dedup-policy.md), [safety-rails](shared/guardrails/safety-rails.md), [path-policy](shared/guardrails/path-policy.md), [cache-policy](shared/memory/cache-policy.md), [memory-schema](shared/memory/memory-schema.md). The execution discipline lives in [methodology/](methodology/README.md) ([§10](#10-execution-methodology)).

---

## 8. What Claude should do in this repo

When you are asked to build POC pieces:

1. **Follow the phase plan** in [EQ-SPARKS-POC-PLAN.md](EQ-SPARKS-POC-PLAN.md). Build in phase order; each phase ends with something runnable.
2. **Honour all guardrails** — model routing, budget ceiling, cache rules, path policy, safety rails, dedup. They are not advisory.
3. **Never commit secrets.** No tokens, keys, or PII anywhere — in code, logs, or examples. MCP auth is browser/OAuth, so nothing sensitive is ever written to a file.
4. **Keep the OS internals out of developer view.** Cache, budget, memory, and telemetry live behind `.eq-sparks/`. Developers see only clean agents and orchestrators. Do not surface OS internals into `.claude/` or `.github/`.
5. **Reference real ids only.** Use the exact agent/skill/command/guardrail ids from this document — never invent one.
6. **Add no runtime dependencies** for POC artifacts.

---

## 9. IDE rendering status

This POC is **Claude-Code-first.** The canonical source — `agents/<layer>/`, `skills/`, `orchestrators/` ([§2](#2-repository-topology--the-estate-rules)) — is **authored and runnable now**, and `bin/render-claude.mjs` renders it into the **generated `.claude/` tree** (`.claude/agents/`, `.claude/commands/`, `.claude/skills/`) that Claude Code executes. Never hand-edit `.claude/`; edit the canonical source and re-render.

The Copilot `.github/` render is **now built** — `bin/render-copilot.mjs` renders the same canonical source (orchestrators → top-level `.github/agents/*-orchestrator.agent.md` selectable in the Agents dropdown, sub-agents grouped under `.github/agents/<category>/`, and on install the full harness OS synced into the gitignored `.eq-sparks/` so agents read it there), so the two IDEs never drift ([§13](#13-distribution)). Cursor is a later adapter, no content rewrite. The manual reconciliation and render steps are tracked in [MANUAL-STEPS.md](MANUAL-STEPS.md).

> One source of truth, many renders. Author once in the canonical layout; let the render (`bin/render-claude.mjs`) and the adapter do the rest.

---

## 10. Execution methodology

The **what** (agents, skills, orchestrators) and the **rules** ([§3](#3-the-operating-model-for-cost) guardrails) are governed by the **how** — the execution discipline in [methodology/](methodology/README.md). Every agent runs it.

### The autoresearch (A-Rag) loop — the Karpathy method

See [methodology/autoresearch-loop.md](methodology/autoresearch-loop.md). Lineage: **Andrej Karpathy**. This is the canonical execution loop for every agent with frontmatter `loop: autoresearch`, bounded by [budget-policy](shared/guardrails/budget-policy.md) (`max_iterations`, `tool_budget`):

1. **Restate** the task in one sentence + list assumptions (think before coding; never invent requirements).
2. **Search** (grep / codebase-search) to locate — do not bulk-read the repo.
3. **Read** narrowly (targeted line ranges), through the cache ([cache-lookup](skills/cache-lookup/SKILL.md)).
4. **Hypothesise:** "the change is X in file Y" (write to the run scratchpad).
5. **Act** — minimal, surgical change (or, for read-only agents, produce the analysis / decision).
6. **Verify** — run tests/checks (writesDiff agents); re-read evidence (read-only agents).
7. **Self-evaluate** against Done Criteria → per-criterion PASS / FAIL + confidence.
8. **Iterate** within budget if a criterion fails; if confidence `< 0.7` **or** [`@critic`](agents/governance/critic.md) FAILs twice, request **one-rung** escalation from [`@supervisor`](agents/governance/supervisor.md) ([model-routing-policy](shared/guardrails/model-routing-policy.md)) — logged + budgeted, never auto-downgrade.
9. **Emit** a handoff envelope to the next agent / `@supervisor`.

Agents with `loop: single-shot` do ONE focused pass (plan / decide / review / scan / check), then steps 7–9 (self-assess + handoff) — no converge loop.

### Self-evaluate — the mandatory gate

[self-evaluate](skills/self-evaluate/SKILL.md) is step 7 and the **mandatory last step before handoff**:

- **writesDiff agents** (produce edits) run the **diff-based** `self-evaluate` skill — its scope is a mutating tree.
- **read-only / gate / planning agents** (no diff) self-*assess* their report/verdict's completeness + confidence instead; an empty diff must never read as FAIL.

### Agent→agent handoff protocol

See [methodology/handoff-protocol.md](methodology/handoff-protocol.md), written/read via the [handoff](skills/handoff/SKILL.md) skill. Agents compose by passing a **structured handoff envelope** (not free text), stored at `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json`:

```
{ run_id, seq, from_agent, to_agent, stage, task, hypothesis,
  decisions:[{fork,choice,rationale,confidence}], artifacts:{reuse:[],extend:[],create:[]},
  files_touched:[], diff_summary, self_eval:{passed,confidence,unmet:[]},
  open_items:[], budget:{tool_calls_used,remaining}, next }
```

The receiving agent reads the latest envelope addressed to it (the orchestrator routes it); [`@supervisor`](agents/governance/supervisor.md) aggregates all envelopes into the Summary. This is distinct from [`/resume`](orchestrators/resume.md) (cloud→IDE handoff).

### The agent-memory runtime

Per-run working memory lives under `.eq-sparks/agent-memory/<run-id>/` (gitignored); the contract is [memory-schema](shared/memory/memory-schema.md), committed templates in [shared/memory/templates/](shared/memory/templates/):

- **`scratchpad.md`** — Layer-1 per-run working memory (hypotheses, investigation log, decisions, self-eval, outcome).
- **`ledger.jsonl`** — idempotent task ledger: one JSON line per task `{task_id, content_hash, status: done|pending|blocked, agent, ts}`. [`/resume`](orchestrators/resume.md) skips `status:done`.
- **`handoff/*.json`** — the envelopes above.
- **`metadata.json`** — `{ run_id, pbi_id, profile, branch, started_at }`.

### Parallelisation — fan-out, serialise, barrier

See [methodology/parallelization.md](methodology/parallelization.md). One rule, the same Karpathy discipline applied to *scheduling*: **independent agents run in parallel; dependent steps serialise; the [`@critic`](agents/governance/critic.md) gate and the [`@supervisor`](agents/governance/supervisor.md) go/no-go are barriers (join points) that nothing crosses until reached.** Only the orchestrator (the main thread) fans agents out — subagents never launch subagents. Parallelisation cuts wall-clock **without lowering the quality bar**: the same agents, the same A-Rag loop, the same governance trio and [self-evaluate](skills/self-evaluate/SKILL.md) gates — only the *ordering* of independent work changes. Every orchestrator carries a `## Parallelisation` note saying explicitly what runs concurrently and where it barriers.

---

## 11. Guardrails registry

See [guardrails-registry](shared/guardrails/guardrails-registry.md) — the single numbered catalogue of every hard rule, **G1–G14** (the platform floor, reproduced verbatim — never renumbered) plus **G15–G20** (the EQ-specific rails: no duplicate code / move to `eq-one-shared`, no hand-rolled UI, no contract drift, no dead code, MFE boundaries, BFF stays a BFF). Numbering is **stable and append-only**; new rails arrive at **G21+** only via the [`@learner`](agents/platform/learner.md) / **G14** PR path — proposed, never auto-activated. Each row names its **enforcing agent** and **enforcement point**. The registry is the catalogue; [safety-rails](shared/guardrails/safety-rails.md) is the agent-level playbook. Enforced fail-fast in three places: [`@critic`](agents/governance/critic.md) at the review gate, [`@supervisor`](agents/governance/supervisor.md) at each stage gate, and hooks/CI at the pipeline.

---

## 12. Observability

Agents and skills emit **one JSONL event per action** (the telemetry schema) to a **pluggable sink**, configured in `.eq-sparks.yml` (`telemetry.sink: local|newrelic`). The **default sink is the local `.eq-sparks/telemetry/<run-id>.jsonl`** — it works **today**, nothing blocks on it. The **NewRelic sink is config-gated and OFF until provisioned** (`newrelic.enabled: false` by default; `account_id` + license supplied via ENV / secret store, **never committed**). Agents work regardless of which sink is active. [`@infra`](agents/platform/infra.md) reads whichever sink is live (local until NewRelic is provisioned, then NewRelic) and surfaces run telemetry / cost / health to [`@supervisor`](agents/governance/supervisor.md) and the console — **reporting, never deploying**. The schema and sink contracts live in [shared/telemetry/](shared/telemetry/telemetry-schema.md) ([sinks](shared/telemetry/sinks.md), [newrelic-sink](shared/telemetry/newrelic-sink.md)). Telemetry is OS-internal — it stays behind `.eq-sparks/`, never surfaced to developers.

---

## 13. Distribution

A consumer repo bootstraps eq-sparks with **`install.js` / `install.sh`**, which install the **`eq-sparks` CLI** ([cli/eq-sparks.mjs](cli/eq-sparks.mjs), exposed via `npx` in `package.json`). The CLI runs **`init` / `sync` / `update`** with flags **`--profile`** (which agent/skill/rule subset renders — see [§6](#6-profiles)), **`--ide`** (Claude Code or Copilot), and **`--offline-only`**. It renders the chosen profile's subset into the IDE's native format and lands the OS internals behind a gitignored `.eq-sparks/`.

Both rendered trees are **generated, never hand-edited**:

- **`.claude/`** — produced by [bin/render-claude.mjs](bin/render-claude.mjs): `agents/` → `.claude/agents/`, `orchestrators/` → `.claude/commands/`, `skills/` → `.claude/skills/`.
- **`.github/`** (Copilot — now built) — produced by [bin/render-copilot.mjs](bin/render-copilot.mjs): **orchestrators → `.github/agents/*-orchestrator.agent.md`** (root, selectable in the Agents dropdown), **sub-agents → `.github/agents/<category>/`** (`user-invocable: false`); on install the full harness OS is synced into the gitignored `.eq-sparks/` and agents are rewritten to read it there.

One canonical source, two renders, no drift. Edit the canonical source and re-render; never hand-edit `.claude/` or `.github/`.
