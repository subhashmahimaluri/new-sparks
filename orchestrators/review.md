---
description: Review orchestrator — fetch a PR/branch diff, run a governed 6-lens review (correctness, security, perf, a11y, contract, style), and gate with the governance trio.
argument-hint: "[PR number | branch]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, TodoWrite
version: 0.1.0
status: poc
uses_skills: console-render, cache-lookup, self-evaluate, contract-diff, budget-check
---

# /review

Turn a pull request or branch into a **cross-repo-aware, governed code review**. This orchestrator (the main thread) is the ONLY thing that launches subagents via the `Agent` tool — subagents never spawn further subagents. `@supervisor` plans the stages and the tool-call/token budget up front; worker agents produce; `@critic` gates each lens with a strict PASS/FAIL; `@supervisor` makes the final go/no-go verdict. `@decision` resolves any ambiguity (which repo a file belongs to, whether a diff hunk crosses an MFE boundary, reuse-vs-create calls) with a logged, defensible rationale.

Target under review: **$ARGUMENTS**

## Operating model (always on)

- **Haiku-first ladder** — each lens runs at its agent's default tier (see `model-routing-policy`). Escalate ONE rung only on low self-eval confidence (<0.7) or two `@critic` FAILs; the escalation is logged and budgeted, never auto-downgraded.
- **Cache** — diff fetch and any read-only repo scans go through `cache-lookup` (keyed on `skill_id`, version, `input_hash`) so re-running `/review` on the same PR head SHA never re-pays for the same scan. NEVER cache `@critic` verdicts, self-eval, tests, or LLM completions (per `cache-policy`).
- **Budget** — `budget-check` tallies tool-calls + tokens against the ceiling from `budget-policy` after every stage; if the run approaches the ceiling, `@supervisor` narrows the remaining lenses rather than blowing the budget.
- **Guardrails** — honour `path-policy` (read where allowed), `safety-rails` (no secrets, no PII in logs), and `dedup-policy` (flag duplicated code that should move to `eq-one-shared`). No secrets are ever emitted.
- **Console** — every stage emits the standardised three-part console via `console-render` (see `console/CONSOLE-UX.md`): an **Intro card** at the start, one **block per stage**, and a **Summary** at the end.

## Staged flow

### Stage 0 — Plan & budget (`@supervisor`)
Launch `@supervisor` to read the target, plan the lenses to run, and allocate the tool-call/token budget from `budget-policy`. It emits the **Intro card** via `console-render` (target PR/branch, repos in scope, lenses queued, budget ceiling). `@supervisor` also opens the per-run **agent-memory** ledger (`metadata.json`, `scratchpad.md`, `ledger.jsonl`, `handoff/` per `memory-schema`'s runtime layout) so the run is auditable and resumable.

### Stage 1 — Fetch diff
Resolve `$ARGUMENTS` to a concrete diff. For a PR number, fetch via `gh pr diff` (Bash); for a branch, diff against the merge-base of the default branch (Bash). Route the fetch through `cache-lookup` keyed on the head SHA so a repeated review is free. Map each changed path to its repo/MFE/BFF-domain owner so downstream lenses know their scope; if ownership is unclear, launch `@decision` to make the call and log it. Emit the stage block (files changed, repos touched, head SHA, cache hit/miss), then route a structured **handoff envelope** (the `handoff` skill, `methodology/handoff-protocol.md`) carrying the changed paths + ownership map to the first lens.

### Stage 2 — 6-lens review (parallel where budget allows)
Launch the six lenses. Read-only review lenses (`@security`, `@perf`, `@a11y`, plus `@reviewer`'s correctness/style passes) report **findings + confidence** without `self-evaluate` — they produce no working diff, so `self-evaluate`'s `empty-diff`-as-FAIL would wrongly block a clean review. Only a lens that actually writes a diff runs `self-evaluate` before handing back: `@codegen` when it drafts a concrete fix, and `@contract` only when it patches FE types. Read-only scans use `cache-lookup`:
1. **Correctness** — `@reviewer` first for cheap structural/logic issues; `@codegen` only if a concrete fix needs drafting.
2. **Security** — `@security` reasons over authz on every changed route/endpoint, secret exposure, PII-in-logs, injection/SSRF surfaces.
3. **Performance** — `@perf` checks bundle size, re-render hotspots, N+1 queries, downstream call fan-out.
4. **Accessibility** — `@a11y` checks changed screens against WCAG 2.2 AA (aria, focus order, contrast, keyboard nav).
5. **Contract** — `@contract` runs the `contract-diff` skill to pin the FE↔BFF boundary against the ExperienceAPI contract and FAILs on drift.
6. **Style** — `@reviewer` checks EQ conventions and style so the opus-tier `@critic` spends budget only on hard calls.

Each lens runs its autoresearch loop (`methodology/autoresearch-loop.md`), self-evaluates (diff-writing lenses) or self-assesses (read-only lenses) before handing off, and emits a handoff envelope back to `@supervisor`/the next stage plus its own stage block via `console-render` with findings + self-eval confidence.

### Stage 3 — Critic gate (`@critic`)
Launch `@critic` to adversarially review the aggregated lens output against EQ standards and return **PASS / FAIL** with required changes. A **FAIL BLOCKS** the review and routes the handoff envelope **back** to the offending lens (re-run that worker, escalate one tier per the ladder on a second FAIL); a PASS hands the envelope forward to `@supervisor`. Only when `@critic` returns PASS does the flow advance. Emit the gate block.

### Stage 4 — Verdict (`@supervisor`)
Launch `@supervisor` to make the **go/no-go verdict**, run `budget-check` one final time, and aggregate the run by reading **every** envelope under `handoff/*.json` in `seq` order. It emits the **Summary** via `console-render`: per-lens PASS/FAIL, blocking issues, escalations taken, cache hit-rate, and budget spent vs. ceiling.

## Handoff & memory

Stages compose by **handoff envelope**, not free text. Between every stage the orchestrator (the main thread) routes a structured envelope — written and read via the `handoff` skill per `methodology/handoff-protocol.md` and stored at `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json` — from one agent to the next: Stage 1's diff/ownership map to the lenses, each lens's findings to `@critic`, `@critic`'s PASS/FAIL to `@supervisor` (a FAIL routes back to the offending lens). At **Stage 0** `@supervisor` opens (and through the run updates) the per-run agent-memory ledger (`metadata.json`, `scratchpad.md`, `ledger.jsonl`, `handoff/` — see `shared/memory/memory-schema.md`'s runtime layout); at **Stage 4** it aggregates **all** envelopes in `seq` order into the `console-render` Summary. Each build/lens agent runs its autoresearch loop (`methodology/autoresearch-loop.md`) and self-evaluates (diff-writing lenses) or self-assesses (read-only lenses) as the last step before emitting its handoff.

## Steps

1. Launch `@supervisor` (`Agent`) to plan the lenses + budget from `budget-policy`, open the agent-memory ledger (`memory-schema` runtime layout), and emit the Intro card via `console-render`.
2. Resolve `$ARGUMENTS` to a diff (`Bash`: `gh pr diff` for a number, merge-base diff for a branch); route through `cache-lookup` on head SHA, then hand off the diff + ownership map to the lenses via the `handoff` skill.
3. Map changed paths to repo/MFE/BFF-domain owners; if ownership is ambiguous, launch `@decision` (`Agent`) for a logged call.
4. Launch the 6 lenses via `Agent` — `@reviewer` (correctness + style), `@security`, `@perf`, `@a11y`, `@contract` (with `contract-diff`). Read-only lenses report findings + confidence without `self-evaluate`; only diff-writing lenses run `self-evaluate` last — `@codegen` when it drafts a concrete fix and `@contract` only when it patches FE types. Read-only scans use `cache-lookup`.
5. Aggregate findings and launch `@critic` (`Agent`) for the PASS/FAIL gate.
6. On FAIL: loop back to the failing lens, re-run (escalate one tier on a second FAIL per `model-routing-policy`), then re-gate. On PASS: continue.
7. Launch `@supervisor` (`Agent`) for the go/no-go verdict; run `budget-check`; aggregate every `handoff/*.json` envelope in `seq` order and emit the Summary via `console-render`.

## Usage

```
/review 4821
```
Review PR #4821: fetch its diff, run all six lenses, gate with `@critic`, return `@supervisor`'s verdict.

```
/review feature/saye-contributions-panel
```
Review a branch by diffing it against the default branch's merge-base, then the full governed flow.

```
/review 4821 --lenses=security,contract
```
Scope the review to just the named lenses (others skipped) when budget is tight — `@supervisor` honours the narrowed scope and `budget-check` reflects it.

---

## Resume & checkpoint (interruption-safe)

This orchestrator is resumable after any interruption (IDE closed, crash, cancel). At **Stage 0** the orchestrator writes `.eq-sparks/agent-memory/<run-id>/metadata.json` with `orchestrator: "review"` and the ordered `stages` list, and seeds `ledger.jsonl` with each stage `pending`. After **every** stage passes its gate, the orchestrator — the main thread, which holds `Write`; `@supervisor` is read-only and only specifies *what* to record — **appends a `done` line** to `ledger.jsonl` with that stage's `task_id` + `content_hash` (per [dedup-policy](../shared/guardrails/dedup-policy.md) / [memory-schema](../shared/memory/memory-schema.md)). The ledger is written **incrementally after every stage, not only at the end**, so finished stages survive an interruption. PBI/Figma context is read from the no-TTL **story cache** `.eq-sparks/cache/story-cache/<pbi>.json` and is **never re-fetched**. If interrupted, **`/resume`** reads `metadata.json`, re-enters *this* orchestrator at the first `pending` stage, and skips work already marked `done`.
