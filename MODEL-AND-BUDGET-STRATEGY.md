---
title: Model & Budget Strategy
id: model-and-budget-strategy
version: 1.0.0
status: canonical
audience: budget-owners, engineering-leadership, team-leads
related:
  - model-routing-policy
  - budget-policy
  - cache-policy
  - dedup-policy
---

# Model & Budget Strategy

**The one question this document answers:** *How do we get strong, governed output from a fleet of 26 agents — running continuously across 20–50 developers — while spending pennies per run, even leaning on the cheap Haiku model?*

This is the document that justifies the architecture to whoever signs the bill. It is concrete and numeric. The enforcement details live in four guardrail docs that this strategy ties together: **model-routing-policy** (the ladder), **budget-policy** (the ceilings), **cache-policy** (the cache stack), and **dedup-policy** (no-repeat). This doc is the *why* and the *math*; those four are the *rules as code*.

---

## 1. The Problem: "Always Use the Best Model" Does Not Scale

eq-sparks is a central agentic harness that syncs into every consumer repo behind `.eq-sparks/`. Developers fire slash-command orchestrators (`/scaffold`, `/review`, `/fix-pentest`, `/contract-sync`, `/refactor-shared`, `/resume`) as a normal part of their day. Each command fans out across the 26-agent roster.

Now do the arithmetic on the naive policy:

- **Team size:** 20–50 developers.
- **Runs per dev per day:** conservatively 3–6 (a scaffold here, a review there, a contract sync).
- **Orchestrator fan-out:** a single `/scaffold` touches a dozen-plus agents, each making multiple tool calls and LLM completions.
- **Naive model choice:** route *everything* to the strongest model.

A frontier-tier model is roughly **40–60× the per-token cost** of the cheapest tier. If every one of the ~40–60 LLM touches in a run went to the top tier, a single `/scaffold` run lands in the **multi-dollar** range. Multiply by 30 devs × 5 runs/day × 220 working days and you are staring at a **five-to-six-figure annual model bill** for a *harness* — before the team has shipped a single feature with it. That is indefensible, and it is also *wasteful*: the overwhelming majority of agent work is mechanical (write a test, scan a dependency diff, update a README, check WCAG rules) and does not need a reasoning-heavy model at all.

The platform's thesis is the inverse: **default everything to the cheapest model that can do the job correctly, prove quality with a strict gate, and spend the expensive model only on the handful of genuine judgment calls — once per stage.** Combine that with aggressive caching and a no-repeat ledger, and the same run that cost multiple dollars naively comes in around **$0.13** (see the worked example in §6). That is the difference between "we can't afford to run this" and "run it on every PBI."

Three pillars deliver it:

1. **A Haiku-first model ladder** (§2) — every agent has a default tier; most sit on Haiku or Sonnet.
2. **Confidence-gated escalation** (§3) — the *only* way work climbs a rung, always logged and budgeted.
3. **A cache stack + no-repeat ledger** (§4, §5) — never pay twice for the same work.

---

## 2. The Three-Rung Ladder

Codified in **model-routing-policy**. Every agent declares a default `model` tier in its frontmatter. The rule for *which* rung is simple and is applied per agent based on the *kind* of cognition the agent does:

| Rung | Model | What lives here | Cost shape |
|------|-------|-----------------|------------|
| **Rung 1** | `haiku` | Mechanical, rule-based, well-scoped work where the answer is a lookup or a pattern-match against a known standard. | Cheapest. The default floor. |
| **Rung 2** | `sonnet` | Code generation, surgical edits, and domain specialists — work that needs real competence but not deep adversarial judgment. | Mid. The workhorse tier. |
| **Rung 3** | `opus` | Judgment calls: governance, system design, security threat reasoning. Invoked **sparingly — at most once per stage**. | Premium. Spent deliberately. |

### 2.1 The full agent → tier table (all 26)

| # | Agent | Layer | Default tier | Why it sits here |
|---|-------|-------|--------------|------------------|
| 1 | `@supervisor` | governance | **opus** | Owns the run: plans stages, allocates the budget, enforces guardrails, makes the go/no-go call. Pure judgment; a wrong call here wastes the whole run. |
| 2 | `@decision` | governance | **opus** | Resolves ambiguity at every fork (vague PBI, missing contract, reuse-vs-create). A *defensible* decision needs reasoning, not pattern-matching. |
| 3 | `@critic` | governance | **opus** | The adversarial quality gate. PASS/FAIL must be trustworthy enough to *block* a stage — it has to out-think the worker it reviews. |
| 4 | `@architect` | core | **opus** | System/design decisions and decomposition: where code belongs, the shape of the change, the sub-task sequence. Read-only judgment. |
| 5 | `@security` | core | **opus** | Threat reasoning: authz on every route, injection/SSRF surfaces, no secrets/PII in logs. False negatives are expensive; worth the top tier. |
| 6 | `@codegen` | core | **sonnet** | General-purpose code generation and surgical edits. Needs competence, not adversarial judgment. The workhorse. |
| 7 | `@reviewer` | core | **sonnet** | Standard correctness/style/convention review *before* `@critic` — catches the cheap-to-find issues so opus budget is spent only on hard calls. |
| 8 | `@integration-tester` | core | **sonnet** | Authors cross-module / cross-MFE integration tests. Requires understanding interactions — beyond mechanical. |
| 9 | `@contract-tester` | core | **sonnet** | Authors contract tests that pin the FE↔BFF boundary and fail on drift. Needs the contract semantics. |
| 10 | `@perf` | core | **sonnet** | Performance review: bundle size, re-render hotspots, N+1 queries, downstream fan-out. Analytical but rule-anchored. |
| 11 | `@tester` | core | **haiku** | Writes and runs unit tests, reads results. Mechanical and well-scoped — ideal for Haiku. |
| 12 | `@scanner` | core | **haiku** | Mechanical scans: dependency diffs, dead-code, secret-pattern regex, lint output. Pure pattern work. |
| 13 | `@docs` | core | **haiku** | Updates READMEs, JSDoc/XML-doc, changelogs to match the diff. Low-judgment. |
| 14 | `@mfe` | frontend | **sonnet** | Scaffolds/extends a child MFE and wires it into the `eq-nexus-ui` shell, respecting module-federation contracts. Real codegen. |
| 15 | `@shared-curator` | frontend | **sonnet** | Detects duplicated code across MFEs and moves it to `eq-one-shared`. Needs to reason about equivalence, not just text-match. |
| 16 | `@design-system` | frontend | **sonnet** | Forces UI to consume `eq-one-design-system` components and blocks hand-rolled equivalents. Component-mapping judgment. |
| 17 | `@state` | frontend | **sonnet** | Applies EQ Zustand store patterns; common stores go to `eq-one-shared`. Pattern application with placement decisions. |
| 18 | `@contract` | frontend | **sonnet** | Keeps FE types/clients aligned to the ExperienceAPI BFF contract; fails on drift. Semantic diff work. |
| 19 | `@a11y` | frontend | **haiku** | Checks screens against WCAG 2.2 AA (aria, focus order, contrast, keyboard nav). Mostly rule-based. |
| 20 | `@domain-folder` | bff | **sonnet** | Scaffolds a new independently-deployable domain folder in ExperienceAPI (`src/domains/<name>/`). Structured codegen. |
| 21 | `@bff-shaper` | bff | **sonnet** | "Paints & polishes" downstream→UI request/response shapes. Shape-transform reasoning. |
| 22 | `@downstream-connector` | bff | **sonnet** | Wires downstream clients with resilience (Polly), timeouts, retries. Needs correct resilience patterns. |
| 23 | `@contract-publisher` | bff | **sonnet** | Publishes the per-domain OpenAPI/Swagger contract the FE `@contract` agent consumes. Generation against a schema. |
| 24 | `@infra` | platform | **sonnet** | Reads infra + observability sinks and enforces deploy/quality gates (G7, G13); surfaces telemetry/cost/health. Reads and reports — competent analysis, not top-tier judgment. |
| 25 | `@db` | platform | **sonnet** | Data-access correctness on the ExperienceAPI BFF (G8 async, G9 parameterised SQL, connection/transaction/timeout, no N+1). Real codegen against patterns. |
| 26 | `@learner` | platform | **sonnet** | Curated-learning loop: reads cross-run telemetry/outcomes and *proposes* durable lessons (G14: human-approved via PR). Analytical synthesis, never auto-activates. |

### 2.2 The distribution that makes the budget work

| Tier | Count | Agents |
|------|-------|--------|
| **haiku** | 4 | `@tester`, `@scanner`, `@docs`, `@a11y` |
| **sonnet** | 17 | `@codegen`, `@reviewer`, `@integration-tester`, `@contract-tester`, `@perf`, `@mfe`, `@shared-curator`, `@design-system`, `@state`, `@contract`, `@domain-folder`, `@bff-shaper`, `@downstream-connector`, `@contract-publisher`, `@infra`, `@db`, `@learner` |
| **opus** | 5 | `@supervisor`, `@decision`, `@critic`, `@architect`, `@security` |

**~81% of the roster (21 of 26 agents) defaults to Haiku or Sonnet.** Opus is reserved for the five agents that make irreversible judgment calls — the governance trio (`@supervisor`, `@decision`, `@critic`) plus the architect and security. And even those five are invoked *sparingly, ideally once per stage* — they are gates and planners, not per-line workers.

Note the deliberate *cheap-filter-before-expensive-gate* design: `@reviewer` (sonnet) runs ahead of `@critic` (opus) so the expensive adversarial reviewer only ever looks at output that already passed the cheap review. That single ordering decision keeps opus call counts low without lowering the quality bar.

---

## 3. Confidence-Gated Escalation

A fixed ladder would be brittle — sometimes a Haiku agent genuinely hits a problem it cannot do well. The answer is **escalation, never silent downgrade**, governed by **model-routing-policy** and metered by **budget-policy**.

### 3.1 The only two triggers

Work climbs **exactly one rung** when, and only when, one of these fires:

1. **Low self-eval confidence** — the `self-evaluate` skill (mandatory before any worker hands off) returns a confidence score **< 0.7**.
2. **Two critic FAILs** — `@critic` returns FAIL twice on the same task. The third attempt runs one rung up.

A Haiku agent escalates to Sonnet; a Sonnet agent escalates to Opus. Escalation is **one rung at a time** — never Haiku straight to Opus.

### 3.2 Hard rules

- **Always logged.** Every escalation writes a record to the run log: agent id, trigger (confidence value or FAIL count), from-tier → to-tier, and the task it applied to. This is auditable by humans and by `@supervisor`.
- **Always budgeted.** An escalation consumes budget. If it would breach the run ceiling, `@supervisor` makes a go/no-go call rather than silently overspending — escalation is a *decision*, not an automatic right.
- **Never auto-downgrade.** The system does not quietly drop an agent to a cheaper tier mid-run to "save money." Cost control comes from the *defaults* and the *gate*, not from gambling on quality after the fact. Downgrading a default tier is a config change in `.eq-sparks.yml` (§7), made deliberately by a team lead — never by the runtime.

### 3.3 Why this is cheap in practice

Escalation is the exception, not the rule. Most tasks pass `self-evaluate` ≥ 0.7 and clear `@critic` on the first or second pass. So the *expected* cost of a run stays anchored to the default-tier distribution in §2.2; escalation adds a small, bounded, logged tail — and that tail is exactly where you *want* to spend more, because it is where the cheap model was visibly unsure.

---

## 4. The Cache Stack

Three layers, governed by **cache-policy**. Each removes a different class of repeated spend.

### 4.1 Per-run skill-output cache

- **What:** caches the output of a skill, keyed on `(skill_id, version, input_hash)`, for the duration of a single run. Accessed through the `cache-lookup` primitive.
- **Saving:** within one `/scaffold` run, the same skill is often invoked with identical inputs by different agents — e.g. `dna-precheck` results, `ado-context`, `figma-context`, `contract-diff`. The first call pays; every subsequent identical call is a free lookup. On a fan-out orchestrator this routinely eliminates **5–10 redundant skill executions per run**, many of them MCP round-trips that are slow as well as costly.
- **Never cached:** writes, test executions, `self-evaluate`, and raw LLM completions. Caching any of those would either hide real state changes or fossilise a stale judgment. This exclusion is non-negotiable and is enforced by cache-policy.

### 4.2 Opt-in cross-run cache

- **What:** an *opt-in* cache that survives across runs, scoped to **stable PBI metadata** — the ADO work-item context (title, description, acceptance criteria, tags, parent epic, Figma URLs) that does not change between a cloud run and a later IDE resume.
- **Saving:** the `/resume` orchestrator (Flow 3, cloud→IDE handoff) explicitly resumes a prior run **without re-fetching ADO/Figma**. The cross-run cache is what makes that safe: the expensive MCP fetches (`ado-context`, `figma-context`) happen once and are reused. On a resume, that is often the **two most expensive non-LLM operations entirely avoided.**
- **Opt-in, by design:** because it crosses run boundaries it is opt-in per cache-policy — you only persist data you have asserted is stable, so you never serve a developer a stale contract or a changed acceptance criterion.

### 4.3 Anthropic prompt-cache alignment

- **What:** every agent prompt is assembled with a **stable prefix** and a volatile tail, in this exact order:

  ```
  [ platform context  |  agent spec  |  volatile task ]
        stable prefix              cacheable boundary
  ```

  The platform context and the agent's own spec are identical across many calls within a window, so they sit first; only the per-task payload changes and sits last. This aligns with Anthropic prompt caching on a **5-minute TTL**.
- **Saving:** cached prompt-prefix tokens are billed at a steep discount versus full input tokens. In a fan-out run where 15+ agents share the same platform context within a 5-minute window, the platform/spec prefix is read from cache on nearly every call after the first. Because that prefix is frequently the *largest* part of the input, this is often the single biggest token-level saving in the whole stack — it cuts effective input-token cost on repeated calls dramatically, and it stacks on top of the Haiku-first routing rather than competing with it.

### 4.4 How the three layers compose

They are orthogonal and additive:

- **Skill cache** kills repeated *skill executions* within a run.
- **Cross-run cache** kills repeated *expensive fetches* across runs.
- **Prompt cache** kills repeated *prefix tokens* on every LLM call.

A single `/scaffold` benefits from all three at once.

---

## 5. No-Repeat: Never Pay Twice for the Same Work

Caching stops you re-*computing* the same thing. The no-repeat pillar, governed by **dedup-policy**, stops you *generating* the same thing — and stops a resumed run from redoing finished work. Two mechanisms.

### 5.1 DNA pre-check (before any code is generated)

Every build agent runs the `dna-precheck` skill **first**, before generating a line. It performs a cross-repo "DNA" scan and classifies the change as one of:

- **REUSE** — the capability already exists; consume it, generate nothing.
- **EXTEND** — something close exists; extend it rather than duplicate.
- **CREATE** — genuinely new; generate it.

The **reuse precedence is REUSE > EXTEND > CREATE.** This is the cheapest possible "generation": the cheapest token is the one you never emit. It also enforces the estate's core rule — *common code moves to `eq-one-shared`, child MFEs must not duplicate* — because the pre-check surfaces existing shared code before an MFE re-invents it, and `@shared-curator` then moves anything genuinely common.

### 5.2 Idempotent task ledger

Captured in the agent-memory schema (`memory-schema`) and enforced by dedup-policy. Each unit of work is recorded in an **idempotent task ledger** keyed by task identity. On a `/resume`:

- Tasks already marked **done** are **skipped** — not re-run, not re-billed.
- Only outstanding work proceeds.

This is what turns a cloud→IDE handoff from "start over" into "pick up where it stopped." Combined with the cross-run cache (§4.2), a resume can re-enter a partially-complete `/scaffold` and pay for *only the remaining tasks* — frequently a small fraction of the original run.

---

## 6. Worked Example: One `/scaffold` on a Child MFE

Scenario: a developer runs `/scaffold <PBI-id>` to scaffold a new feature in `eq-one-saye-mfe`, wired into the `eq-nexus-ui` shell, with a matching BFF domain shape. We count the LLM touches, show where they land on the ladder, and tally the cost against the **60-tool-call ceiling** from budget-policy.

### 6.1 Stage-by-stage call accounting

| Stage | Touch | Agent / Skill | Tier | Notes |
|-------|-------|---------------|------|-------|
| **0. Plan** | 1 | `@supervisor` plans stages + allocates budget | **opus** | One judgment touch. |
| | 2 | `ado-context` (MCP) | — | Fetched once; cached cross-run for `/resume`. |
| | 3 | `figma-context` (MCP) | — | Fetched once; cached. |
| **1. Decide** | 4 | `@decision` resolves placement (saye-mfe vs shared) | **opus** | One judgment touch. |
| | 5 | `@architect` designs the change + sub-task sequence | **opus** | One judgment touch (read-only). |
| **2. Pre-check** | 6 | `dna-precheck` (REUSE/EXTEND/CREATE) | — | Cheap skill; result cached per-run, reused below. |
| **3. Build (FE)** | 7 | `@mfe` scaffolds + wires into shell | **sonnet** | |
| | 8 | `@design-system` enforces design-system components | **sonnet** | |
| | 9 | `@state` applies Zustand store pattern | **sonnet** | |
| | 10 | `@contract` aligns FE types to BFF contract | **sonnet** | uses cached `contract-diff`. |
| | 11 | `self-evaluate` per build agent | — | Mandatory; never cached. |
| **4. Build (BFF)** | 12 | `@domain-folder` scaffolds `src/domains/<name>/` | **sonnet** | |
| | 13 | `@bff-shaper` shapes response for the UI | **sonnet** | |
| | 14 | `@downstream-connector` wires Polly/timeouts | **sonnet** | |
| | 15 | `@contract-publisher` publishes OpenAPI | **sonnet** | |
| **5. Test** | 16 | `@tester` writes + runs unit tests | **haiku** | |
| | 17 | `@contract-tester` pins FE↔BFF boundary | **sonnet** | |
| | 18 | `@a11y` WCAG 2.2 AA check | **haiku** | |
| **6. Scan** | 19 | `@scanner` dep diff + secrets + lint | **haiku** | |
| | 20 | `@docs` updates README/changelog | **haiku** | |
| **7. Review** | 21 | `@reviewer` cheap correctness/style pass | **sonnet** | runs *before* critic. |
| | 22 | `@perf` bundle/render/N+1 review | **sonnet** | |
| **8. Gate** | 23 | `@security` threat reasoning | **opus** | One judgment touch. |
| | 24 | `@critic` strict PASS/FAIL | **opus** | One judgment touch. |
| **9. Summary** | 25 | `@supervisor` aggregates + go/no-go | **opus** | (Same opus agent as stage 0; the run's final touch.) |
| | 26 | `budget-check` + `console-render` | — | Tally + standardised console output. |

### 6.2 Where the touches land

Counting the **LLM agent touches** (the billable model calls — excluding the cached/free skill and MCP rows):

| Tier | Touches | Agents in this run |
|------|---------|--------------------|
| **haiku** | 4 | `@tester`, `@a11y`, `@scanner`, `@docs` |
| **sonnet** | 11 | `@mfe`, `@design-system`, `@state`, `@contract`, `@domain-folder`, `@bff-shaper`, `@downstream-connector`, `@contract-publisher`, `@contract-tester`, `@reviewer`, `@perf` |
| **opus** | 5 | `@supervisor` (plan + summary), `@decision`, `@architect`, `@security`, `@critic` |

**15 of 19 agent touches (~79%) land on Haiku or Sonnet.** Opus appears for exactly the five judgment/governance touches — and each opus agent fires **once in its stage**, never in a loop. That is the design target: ~80% cheap, opus only on the ~5 governance/judgment touches per stage.

### 6.3 Tool-call budget

Across all 26 rows the run makes on the order of **40–55 tool calls** once you account for each agent's Read/Grep/Write/Bash activity — comfortably **under the 60-tool-call ceiling** defined in budget-policy. `budget-check` (row 26) tallies the live count against that ceiling; if a confidence-gated escalation (§3) threatens to push over, `@supervisor` makes the go/no-go call rather than silently overrunning.

### 6.4 The dollar tally

Rough per-run cost, anchored to the distribution above and *with the cache stack active* (prompt-prefix reuse on nearly every call, skill/MCP fetches paid once):

| Tier | Touches | Share of token spend | Rough cost |
|------|---------|----------------------|------------|
| haiku | 4 | small | ~$0.005 |
| sonnet | 11 | the bulk of the *work* tokens | ~$0.08 |
| opus | 5 | small token count, premium rate | ~$0.045 |
| **Total** | **20 touches** | | **≈ $0.13 / run** |

The same run on the naive "always best model" policy — 20 opus touches with no prompt-cache prefix reuse and re-fetched ADO/Figma — runs **multiple dollars**, an order of magnitude or more above this. **At ~$0.13 a governed, tested, reviewed scaffold, you can afford to run it on every PBI** — which is the entire point of building the harness. At 30 devs × 5 runs/day that is roughly **$20/day** in model cost for the whole org's agentic scaffolding, not the four-figures/day the naive policy implies.

> These figures are illustrative planning estimates for the POC, not a billing guarantee; the live numbers come from `budget-check` against budget-policy. The *shape* — ~80% cheap-tier, opus-sparingly, cache-everything-reusable — is the contract.

---

## 7. The Knobs: Tuning Cost vs Quality in `.eq-sparks.yml`

A team lead dials the whole strategy from one file. These fields tune the three pillars; the policies (model-routing-policy, budget-policy, cache-policy, dedup-policy) define their legal ranges and enforce them at runtime.

```yaml
# .eq-sparks.yml — cost/quality knobs (illustrative; same schema as .eq-sparks.yml.example)

# Budgets — the three enforced budgets from budget-policy §1, tallied by budget-check.
budgets:
  max_iterations: 5            # worker→@critic→fix loops per stage
  cost_cap_usd: 2.0            # hard USD ceiling for the whole run
  tool_budget: 60              # max tool calls for the whole run (the POC ceiling used in §6)

# Model routing — per model-routing-policy. HAIKU-first; agents carry their own model:
# field and this block only overrides it. The runtime NEVER auto-downgrades.
model_routing:
  default_tier: per-agent      # per-agent | haiku | sonnet | opus
  allow_escalation: true       # escalate ONE rung on self-eval confidence <0.7
                               # or two @critic FAILs. Logged + budgeted.
  max_tier: opus               # ceiling; escalation never climbs past this.

# Cache — per cache-policy. Per-run skill cache keyed (skill_id, version, input_hash).
# Cross-run is opt-in and only for stable PBI metadata, invalidated by profile_version.
# Non-negotiable exclusions: writes, test runs, self-evaluate, raw LLM completions are
# NEVER cached, regardless of these toggles.
cache:
  per_run: true                # §4.1 — reuse skill output within a single run
  cross_run: false             # §4.2 — opt-in: persist stable PBI metadata across runs
```

### How a team lead actually turns the dials

- **"Cut cost on a low-stakes repo."** Lower `cost_cap_usd` and `tool_budget`, and set `model_routing.default_tier: haiku` to push borderline specialists (e.g. `@perf`) down a rung. The escalation gate still protects quality on the tasks that need it.
- **"Raise quality on a high-stakes change."** Raise `cost_cap_usd`/`tool_budget`/`max_iterations` so more tasks can escalate, or set `model_routing.default_tier` up a rung. Costs more, by choice. The confidence-<0.7 and two-`@critic`-FAILs escalation triggers are fixed by model-routing-policy, not tuned here.
- **"Speed up resumes."** Keep `cache.cross_run: true` so `/resume` re-fetches no stable PBI metadata; the `profile_version` kill switch in cache-policy invalidates it when the metadata shape changes.
- **Always-on guarantees.** Escalation logging, the cache exclusions, and "no auto-downgrade" are not toggles — they are floors set by the policies, so a misconfigured knob can never quietly trade away auditability or correctness.

---

## Summary

The strategy is a single coherent bet: **default cheap, gate hard, cache everything reusable, generate nothing twice.** The Haiku-first ladder puts ~80% of work on the two cheapest rungs; the opus tier is rationed to five judgment agents fired once per stage; confidence-gated escalation buys quality back exactly where the cheap model was unsure, always logged and budgeted; and the cache + no-repeat stack ensures the org never pays twice for the same fetch, computation, or generation. The result — a fully governed, tested, reviewed cross-repo scaffold for around **$0.13 a run, under a 60-tool-call ceiling** — is what makes running 26 agents continuously across 20–50 developers affordable. The enforcement lives in **model-routing-policy**, **budget-policy**, **cache-policy**, and **dedup-policy**; this document is the case for why it adds up.
