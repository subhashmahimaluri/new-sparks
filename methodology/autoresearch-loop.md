---
id: autoresearch-loop
title: The Autoresearch (A-Rag) Loop
kind: methodology
version: 1.0.0
status: active
owner: "@supervisor"
lineage: "Andrej Karpathy — the think-before-coding school of agentic coding"
related: [handoff-protocol, README, budget-policy, model-routing-policy, memory-schema, dedup-policy, cache-policy, path-policy, safety-rails]
canonical_for: "every agent with frontmatter loop: autoresearch (and the loop: single-shot variant)"
---

# The Autoresearch (A-Rag) Loop

**Lineage — the Andrej Karpathy school of agentic coding.** This methodology is a direct
realisation of Andrej Karpathy's approach to coding with models: **think before you code,
keep it simple, change as little as possible.** Restate the problem in your own words and
list your assumptions *before* you touch a file; never invent a requirement the PBI did not
state; locate the one place a change belongs and make the smallest surgical edit that works;
then prove it. eq-sparks turns that discipline into a **bounded research → act → verify
loop** — "A-Rag", autoresearch — that every worker agent runs, metered end-to-end by
`budget-policy` and gated by `self-evaluate`.

The loop is not a vibe. It is nine concrete steps, each bounded by a budget, each leaving an
auditable trace in the run scratchpad, and each ending — win or lose — in a structured
handoff envelope. Cheap models do most of the work because the *thinking* happens in the
loop, not in the model: a Haiku or Sonnet agent that restates, searches narrowly, hypothesises,
and self-evaluates beats a hot model flailing without a plan, at a fraction of the cost.

> **One-line creed:** *Restate, locate, hypothesise, change the minimum, prove it, grade
> yourself, hand off — all under budget.*

---

## The nine-step loop (`loop: autoresearch`)

Every agent whose frontmatter declares `loop: autoresearch` runs **exactly** these nine
steps, in order. The whole loop is bounded by `budget-policy` — specifically `max_iterations`
(the worker→`@critic`→fix cycles per stage, default 5) and `tool_budget` (every tool/skill
call in the run, default 60). `@supervisor` allocates a slice of each to the stage up front;
the agent consumes, `@supervisor` accounts via `budget-check`.

1. **RESTATE** — State the task in **one sentence**, then list your assumptions. Think before
   coding. Never invent requirements: every "must" traces to the PBI acceptance criteria
   (via `ado-context`) or to `@architect`'s task shape. Write the restatement + assumptions
   to the run **scratchpad** (`memory-schema` Layer-1 *Hypothesis* section). *Budget: 0 tool
   calls — this is reasoning, not searching.*

2. **SEARCH** — Locate the change with `grep` / codebase-search. **Do NOT bulk-read the repo.**
   You are finding the one place the change belongs, not building a mental model of everything.
   *Budget: a handful of search calls; each counts against `tool_budget`.*

3. **READ narrowly** — Read only the **targeted line ranges** the search pointed at, **through
   the cache** (`cache-lookup` for cacheable skill outputs; never cache writes/tests/self-eval
   per `cache-policy`). Reading a whole file when you needed twelve lines is wasted budget.
   *Budget: a few narrow reads; cache hits cost nothing.*

4. **HYPOTHESISE** — Commit to a falsifiable claim: **"the change is X in file Y"**. Write it to
   the scratchpad *Investigation log*. A hypothesis you can be wrong about is what makes step 6
   meaningful. *Budget: 0 tool calls.*

5. **ACT** — Make the **minimal, surgical change**: the smallest correct diff that matches the
   existing style — never a rewrite, never a new runtime dependency, only inside the path your
   `path-policy` / `@architect` placement allows. (Read-only agents — see the single-shot
   variant — instead *produce* the analysis / decision / verdict here, not a diff.) Run
   `dna-precheck` first if you are a build agent: **REUSE > EXTEND > CREATE** (`dedup-policy`)
   — the cheapest change is the one you don't write. *Budget: edit/write calls, metered.*

6. **VERIFY** — Prove the change. `writesDiff` agents run the tests/checks for the change
   (lint, type-check, the relevant test, contract diff). Read-only agents **re-read the
   evidence** behind their finding. No "looks right" — produce a green result or concrete
   proof. *Budget: test/Bash/Read calls, metered.*

7. **SELF-EVALUATE** — Grade the work against your declared **Done Criteria**, per criterion:
   `PASS` / `FAIL` + concrete **evidence** (`path:line`, test name, contract field, grep hit)
   + a **confidence** in `[0.0, 1.0]`. This is the **mandatory gate** before any handoff. *See
   §"How self-evaluate gates step 7" below — this is where the loop earns the right to hand
   off.* Write the result to the scratchpad *Self-eval result* section.

8. **ITERATE** — If a criterion `FAIL`s **and** budget remains (`should_retry == true`), loop
   back — typically to step 4 (re-hypothesise) or step 5 (fix) — for another pass within
   `max_iterations`. Two confidence-gated exits:
   - If **`min_confidence < 0.7`** on any criterion, **OR** `@critic` returns **FAIL on the
     same work twice**, request **ONE-rung** escalation from `@supervisor`
     (`model-routing-policy`: Haiku→Sonnet or Sonnet→Opus, never two rungs). It is **logged
     and budgeted, never auto-downgraded** and **never self-promoted**.
   - If iterations or any budget are exhausted, you do **not** silently retry — `@supervisor`
     runs the `budget-policy` §3 exhaustion sequence (telemetry → `self-evaluate` →
     `[partial-budget]` on PASS / `BLOCKED:cost-cap` on FAIL).

9. **EMIT a handoff envelope** — End the loop by writing a structured handoff envelope (the
   `handoff` skill) to the next agent or `@supervisor`. **Not free text** — the schema in
   `handoff-protocol.md`. This is how agents compose; `@supervisor` aggregates every envelope
   into the run Summary. *See §"How the loop ends" below.*

> Steps 1, 4 cost no tool calls — they are pure thinking and are *the point* (Karpathy's
> "think before coding"). Steps 2, 3, 5, 6 spend metered budget. Steps 7–9 are the close-out
> the loop must always reach, even on failure.

---

## The single-shot variant (`loop: single-shot`)

Agents whose frontmatter declares `loop: single-shot` do **one focused pass** — a plan, a
decision, a review, a scan, or a check — and then run **steps 7–9 only** (self-assess →
handoff). **There is no converge loop**: they do not iterate steps 4–6 in a cycle, because
their output is a one-shot judgment, not a diff that converges toward green.

Concretely, a single-shot agent still RESTATEs (1), SEARCHes (2), READs narrowly (3), forms
its HYPOTHESIS/finding (4), and PRODUCES its analysis/verdict (5–6, read-only) — but instead
of looping it then:

- **Self-ASSESSes** the **completeness and confidence of its report/verdict** — it does **NOT**
  run the diff-based `self-evaluate` skill. A planning/gate/read-only agent produces no diff,
  and an empty diff would read as `FAIL` in a diff-grader, which is wrong. This matches the
  explicit *mutating-tree scope* in `self-evaluate/SKILL.md` ("applies to … any other agent
  that mutates the working tree"). Confidence is still scored; `< 0.7` still triggers the same
  one-rung escalation request.
- **Hands off** the same way — a structured envelope (step 9).

So: `loop: autoresearch` = the full converge loop (1→9 with iteration at 8); `loop: single-shot`
= one pass (1→6) then self-ASSESS + handoff (7–9, no converge).

---

## How `self-evaluate` gates step 7 and feeds escalation

Step 7 is not advisory — it is the **gate that decides what happens next**, and it splits
cleanly by whether the agent produced a diff:

- **`writesDiff` agents** run the **diff-based `self-evaluate` skill** as the **MANDATORY last
  step before handoff**. It reads the *fresh* working diff (`cacheable: false`) plus the
  declared Done Criteria and returns, per criterion, `verdict` + `evidence` + `confidence`,
  then rolls up `overall`, `min_confidence`, `should_retry`, and an advisory `escalation_hint`.
  An evidence-free `PASS` is recorded as `FAIL`. This is the bookend to `dna-precheck` (run
  FIRST); `self-evaluate` runs LAST.
- **read-only / gate / planning agents** **self-ASSESS** the completeness and confidence of
  their report/verdict instead — they do **not** invoke the diff-based skill (see the
  single-shot variant above).

Two consumers read step 7's output, both governed:

- **`model-routing-policy`** reads per-criterion confidence. **`min_confidence < 0.7`** on any
  criterion is escalation **trigger (a)**; **two `@critic` FAILs** on the same work is **trigger
  (b)**. Either fires **one** rung of escalation (Haiku→Sonnet→Opus), **requested from
  `@supervisor`**, **logged** (agent id, trigger, failing criterion, from→to tiers, approver),
  and **charged to the budget**. Never two rungs; never self-promoted; never auto-downgraded.
- **`budget-policy` / `@supervisor`** read `should_retry` to decide whether a retry is
  affordable before the stage proceeds. No headroom ⇒ `should_retry: false` ⇒ the exhaustion
  sequence, not a silent loop.

> Confidence is the steering signal of the whole platform: a cheap model that *honestly* scores
> low pulls in a stronger model exactly where judgment is needed, and nowhere else. Confidence
> inflation to dodge escalation starves the router of that signal and is an anti-pattern.

---

## How the loop ends — emit a handoff envelope (step 9)

The loop terminates by **emitting a structured handoff envelope** via the `handoff` skill,
stored at `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json`. This is **not**
free text — the receiving agent (routed by the orchestrator) reads the latest envelope
addressed to it, and `@supervisor` aggregates **all** envelopes into the run Summary. The schema
(see `handoff-protocol.md` for the authority):

```jsonc
{
  "run_id": "...", "seq": 7, "from_agent": "@codegen", "to_agent": "@critic",
  "stage": "build", "task": "one-sentence restatement (step 1)",
  "hypothesis": "the change is X in file Y (step 4)",
  "decisions": [{ "fork": "...", "choice": "...", "rationale": "...", "confidence": 0.9 }],
  "artifacts": { "reuse": [], "extend": [], "create": [] },   // dna-precheck verdicts
  "files_touched": ["..."], "diff_summary": "...",
  "self_eval": { "passed": true, "confidence": 0.88, "unmet": [] },   // step 7 output
  "open_items": [], "budget": { "tool_calls_used": 14, "remaining": 46 }, "next": "@critic gate"
}
```

This is distinct from `/resume` (the cloud→IDE handoff, Flow 3). The envelope is the
**agent→agent** composition primitive within a single run; the Layer-1 ledger
(`memory-schema`) is what makes a `/resume` skip finished work.

---

## Worked example — `@codegen` fixes a small bug (`loop: autoresearch`)

PBI-48213 reports: *"Saye balance summary shows `£NaN` when the holdings array is empty."*
`@codegen` runs at its default tier **sonnet**; `@supervisor` allocated it ~12 tool calls.

| Step | What `@codegen` does | Budget |
|---|---|---|
| 1 RESTATE | *"Guard the empty-holdings case in the Saye balance summary so it renders £0.00, not £NaN."* Assumptions: empty array is valid input; no new dep; fix lives in the FE, not the BFF. → scratchpad *Hypothesis*. | 0 |
| 2 SEARCH | `grep -rn "balance" eq-nexus-ui/src/ … --include='*summary*'` → one hit in `BalanceSummary.tsx`. **No bulk read.** | 2 |
| 3 READ narrowly | Read `BalanceSummary.tsx:38-60` only, through `cache-lookup`. Finds `holdings.reduce(...) / holdings.length` — divide-by-zero when empty. | 1 |
| 4 HYPOTHESISE | Scratchpad: *"The change is X = guard `holdings.length === 0` before the average, in Y = `BalanceSummary.tsx:51`."* | 0 |
| 5 ACT | `dna-precheck`: no shared helper exists for this → **CREATE** the smallest guard inline (3-line early return to `£0.00`). Surgical diff; no rewrite; no new dep. | 2 |
| 6 VERIFY | Add/extend a unit test for the empty case; `vitest` → green; type-check clean. | 3 |
| 7 SELF-EVALUATE | Diff-based `self-evaluate` vs Done Criteria: DC-1 "empty holdings → £0.00" `PASS` (test `renders £0.00 when empty` green, conf 0.93); DC-2 "no regression on non-empty" `PASS` (existing test green, conf 0.9); DC-3 "stays in FE, surgical" `PASS` (1 file, +5/-1, conf 0.97). `overall: PASS`, `min_confidence: 0.9`. | 1 |
| 8 ITERATE | `overall PASS`, `min_confidence 0.9 ≥ 0.7` → **no iteration, no escalation**. | 0 |
| 9 HANDOFF | Emit envelope `…/handoff/0007-codegen-to-critic.json`: `files_touched: [BalanceSummary.tsx, BalanceSummary.test.tsx]`, `self_eval.passed: true`, `budget: {used: 11, remaining: 49}`, `next: "@critic gate"`. | 1 |

`@critic` reads the envelope, PASSes the stage, `@supervisor` folds it into the Summary. Total:
**~11 tool calls, on Sonnet, one pass** — no Opus, because the loop did the thinking and the
self-eval confidence was high. *Had* DC-1 failed or scored `< 0.7`, step 8 would have looped
(re-hypothesise → fix → re-verify → re-self-eval) and, on a second `@critic` FAIL or persistent
low confidence, requested one logged rung of Sonnet→Opus from `@supervisor`.

---

## Anti-patterns (hard NO)

- **Bulk-reading the repo.** Reading whole files or whole directories to "understand the
  codebase" instead of searching narrowly (step 2) and reading targeted line ranges (step 3).
  It burns `tool_budget`, defeats `cache-policy`, and is the opposite of the Karpathy
  locate-the-one-place discipline.
- **Skipping `self-evaluate` (step 7).** Handing off without grading the work against declared
  Done Criteria. For `writesDiff` agents the diff-based `self-evaluate` is **mandatory**; for
  read-only agents the self-ASSESS is mandatory. No grade ⇒ no handoff.
- **Silent retries.** Retrying after a budget hit, or switching models, without `@supervisor`
  re-authorising it. Every escalation and every retry is logged and budgeted — `budget-policy`
  §4 forbids silent retry and silent downgrade alike.
- **Iterating past budget.** Looping step 8 beyond `max_iterations` or past `tool_budget` /
  `cost_cap_usd`. When a budget trips, the only legal move is `@supervisor`'s exhaustion
  sequence (`[partial-budget]` or `BLOCKED:cost-cap`) — never one more "quick" pass.
- **Inventing requirements.** Adding a "must" the PBI never stated (step 1). Every criterion
  traces to `ado-context` acceptance criteria or `@architect`'s task shape.
- **Confidence inflation.** Reporting a high confidence to dodge the `< 0.7` escalation trigger.
  This hides risk and starves `model-routing-policy` of its steering signal.
- **Rewrites instead of surgical diffs** / **new runtime dependencies** (step 5). Both violate
  the simplicity-first creed and `safety-rails`.
- **Free-text handoff.** Ending with prose instead of the schema envelope (step 9) breaks
  agent composition and `@supervisor`'s Summary aggregation.

---

## Which agents are autoresearch vs single-shot

Classification follows the rule baked into `self-evaluate/SKILL.md`: agents that **mutate the
working tree** (`writesDiff`) run the full **`loop: autoresearch`** converge loop and the
diff-based self-evaluate; **read-only / gate / planning** agents run **`loop: single-shot`**
(one pass + self-ASSESS + handoff).

| Loop | Layer | Agents |
|---|---|---|
| **`autoresearch`** (writesDiff — full 1→9 with iteration) | core | `@codegen`, `@tester`, `@integration-tester`, `@contract-tester`, `@docs` |
| | frontend | `@mfe`, `@shared-curator`, `@design-system`, `@state`, `@contract`, `@a11y` |
| | bff | `@domain-folder`, `@bff-shaper`, `@downstream-connector`, `@contract-publisher` |
| **`single-shot`** (read-only / gate / planning — one pass + self-ASSESS) | governance | `@supervisor`, `@decision`, `@critic` |
| | core | `@architect`, `@security`, `@scanner`, `@reviewer`, `@perf` |

> `@reviewer` and `@perf` produce *findings*, not edits, so they self-ASSESS their report rather
> than running the diff-based self-evaluate, even though they default to Sonnet. The dividing
> line is **"did this agent change the tree?"**, not the model tier. The authoritative
> per-agent `loop:` value lives in each agent's own frontmatter; this table is the index.
