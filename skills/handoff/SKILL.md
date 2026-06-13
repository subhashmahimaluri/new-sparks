---
name: handoff
description: Writes and reads the structured agent→agent handoff envelope defined in methodology/handoff-protocol.md, persisting it under .eq-sparks/agent-memory/<run-id>/handoff/ so agents compose by passing structured state, not free text.
kind: skill
id: handoff
version: 0.1.0
status: draft
cacheable: false
---

# handoff

The seam between two agents. Every agent ends its run by writing a handoff envelope; every receiving agent starts its run by reading the latest envelope addressed to it. This skill is the read/write primitive for that envelope — the concrete mechanism behind the agent→agent handoff protocol. It is how `@codegen` tells `@reviewer` what it did, how `@bff-shaper` tells `@contract-publisher` the contract moved, and how `@supervisor` reconstructs the whole run into the Summary. Distinct from `/resume`, which is the cloud→IDE run-level handoff (Flow 3); this is the per-stage, agent-to-agent baton inside a single run.

## Description

`handoff` reads and writes the structured envelope defined in `methodology/handoff-protocol.md`. It has exactly two operations:

- **write** — serialise the envelope object the emitting agent produced and persist it at
  `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json`.
- **read** — load the latest envelope matching a `{to_agent}` (and optionally `from_agent` / `seq`) filter, so the receiving agent picks up the correct baton.

The envelope is **run state, not a cached result** — it changes every stage and is never memoised. Routing (which agent reads which envelope next) is the orchestrator's job; this skill only stores and retrieves by the envelope's addressing fields. `@supervisor` reads *all* envelopes for a run to aggregate them into the Summary.

The envelope schema (per `methodology/handoff-protocol.md`):

```
{ run_id, seq, from_agent, to_agent, stage, task, hypothesis,
  decisions:[{ fork, choice, rationale, confidence }],
  artifacts:{ reuse:[], extend:[], create:[] },
  files_touched:[], diff_summary,
  self_eval:{ passed, confidence, unmet:[] },
  open_items:[], budget:{ tool_calls_used, remaining }, next }
```

Every field is small and structured by design — this is a baton, not a transcript. `diff_summary` is a one-line human-readable summary (e.g. "added PaymentShaper + DTO; 3 files"), NEVER the diff itself.

## Inputs

**write:**
- `envelope` (required) — the fully-populated envelope object above. `run_id`, `seq`, `from_agent`, `to_agent` are mandatory addressing fields; `from_agent` and `to_agent` MUST be exact roster ids, e.g. `@codegen`, `@reviewer`, `@supervisor` (the `@`-prefixed form per `methodology/handoff-protocol.md`). The leading `@` is dropped only in the filename component `<seq>-<from>-to-<to>.json` (per protocol §"Storage"), never in the JSON value. `seq` is the monotonically increasing stage counter for the run.

**read:**
- `run_id` (required) — the run whose handoff directory to read.
- `to_agent` (required) — the receiving agent; selects only envelopes addressed to it.
- `from_agent` (optional) — narrow to envelopes from a specific emitter.
- `seq` (optional) — fetch a specific stage's envelope rather than the latest. When omitted, the **highest `seq`** matching the filter wins (the latest baton).

## Outputs

**write:**
- `path` — the stored envelope path: `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json`.
- `status` — `stored`.

**read:**
- the **latest matching envelope** object (highest `seq` for the `{run_id, to_agent[, from_agent]}` filter, or the exact `seq` if requested).
- on no match → `null` with reason `no-envelope` (the receiving agent then asks `@supervisor` for routing rather than guessing).

## Tools Needed

- `Read` — load envelope JSON files from the run's `handoff/` directory.
- `Write` — serialise and persist the envelope object as JSON.

This skill does not run the autoresearch loop, mutate source, or call any model — it only serialises and deserialises run state.

## Constraints

- **cacheable: false — handoffs are run state, never cached.** An envelope is a fresh per-stage artifact that changes every turn; serving a stale one would route an agent off a prior stage's assumptions. Per `cache-policy` §2 it sits with writes, `self-evaluate`, and raw completions on the never-cache list. Do NOT wrap `handoff` in `cache-lookup`.
- **Path discipline.** Writes go ONLY under `.eq-sparks/agent-memory/<run-id>/handoff/` (gitignored). Writing anywhere else is a `path-policy` violation. The filename is exactly `<seq>-<from>-to-<to>.json`.
- **Roster-bound addressing.** `from_agent` / `to_agent` MUST be exact agent ids; an unknown id is a write error, not a new agent.
- **Small by construction.** The envelope protects the prompt-cache prefix and the receiver's context window — keep it to summaries and pointers. No diffs, no file bodies, no logs.
- **No secrets / no PII.** Per `safety-rails`, never place tokens, credentials, or PII in any field (including `diff_summary` and `open_items`).
- **fail_modes:**
  - `unknown-agent` — `from_agent`/`to_agent` not in the roster → reject the write; do not invent an id.
  - `schema-incomplete` — envelope missing a mandatory addressing field (`run_id`/`seq`/`from_agent`/`to_agent`) → reject the write so a malformed baton is never persisted.
  - `no-envelope` — read filter matches nothing → return `null` + reason; receiving agent escalates routing to `@supervisor` rather than proceeding blind.
  - `diff-in-envelope` — `diff_summary` contains a raw patch/hunk rather than a one-line summary → reject; this bloats context and risks leaking the very thing the envelope must summarise.
  - `seq-collision` — an envelope already exists for that `<seq>-<from>-to-<to>` → reject; `seq` must be unique per emitter/stage (retries advance `seq`, never overwrite).

## When to invoke

- **write — the LAST step of every agent's run**, immediately after `self-evaluate` (for writesDiff agents) or after the agent self-assesses its report/verdict (for read-only/gate/planning agents). The envelope carries the self-eval result and the baton to the next agent / `@supervisor`. This is step 9 ("EMIT a handoff envelope") of the autoresearch loop and the matching single-shot final step.
- **read — the FIRST step of a receiving agent's run**, to pick up the latest envelope addressed to it before it restates the task. Pairs with `dna-precheck` (which build agents run next, FIRST among their own work).
- `@supervisor` reads the full set of envelopes for a `run_id` when aggregating the Summary.

## How it works

1. **write:** receive the populated `envelope`. Validate the mandatory addressing fields and that `from_agent`/`to_agent` are roster ids; reject on `schema-incomplete` / `unknown-agent`.
2. Validate that `diff_summary` is a one-line summary, not a patch (`diff-in-envelope` guard), and that no field carries secrets/PII (`safety-rails`).
3. Compute the path `.eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json`; if a file already exists for that key, reject (`seq-collision`).
4. `Write` the envelope as JSON; return `{ path, status: "stored" }`.
5. **read:** receive `{ run_id, to_agent[, from_agent][, seq] }`. List the run's `handoff/` directory.
6. Filter filenames by `to_agent` (and `from_agent` if given). If `seq` is given, select that exact envelope; otherwise select the **highest `seq`** match.
7. `Read` the selected file and return the parsed envelope object. If nothing matches, return `null` with reason `no-envelope`.

## Example

`@codegen` finishes a SAYE payments component and hands off to `@reviewer`. It writes the envelope to
`.eq-sparks/agent-memory/2026-06-13-scaffold-PBI-48213-a7f1/handoff/0004-codegen-to-reviewer.json`:

```jsonc
{
  "run_id": "2026-06-13-scaffold-PBI-48213-a7f1",
  "seq": 4,
  "from_agent": "@codegen",
  "to_agent": "@reviewer",
  "stage": "implement",
  "task": "Render the SAYE maturity-choice form per PBI-48213 AC-1..3, reusing the design-system field set.",
  "hypothesis": "The change is a new MaturityChoiceForm in eq-one-saye-mfe wiring DS inputs to the payments state slice.",
  "decisions": [
    { "fork": "field components", "choice": "reuse eq-one-design-system <RadioGroup>", "rationale": "dna-precheck classified REUSE; no new control needed", "confidence": 0.93 },
    { "fork": "validation", "choice": "extend shared useMoneyValidation", "rationale": "EXTEND beats CREATE per dedup-policy; one rule added", "confidence": 0.81 }
  ],
  "artifacts": {
    "reuse": ["eq-one-design-system/RadioGroup", "eq-one-shared/useMoneyValidation"],
    "extend": ["eq-one-shared/useMoneyValidation"],
    "create": ["eq-one-saye-mfe/src/features/maturity/MaturityChoiceForm.tsx"]
  },
  "files_touched": [
    "eq-one-saye-mfe/src/features/maturity/MaturityChoiceForm.tsx",
    "eq-one-shared/src/hooks/useMoneyValidation.ts"
  ],
  "diff_summary": "Added MaturityChoiceForm (DS RadioGroup + amount field); extended useMoneyValidation with a min-rule; 2 files.",
  "self_eval": { "passed": true, "confidence": 0.86, "unmet": [] },
  "open_items": ["a11y: confirm RadioGroup labels announce the selected maturity option"],
  "budget": { "tool_calls_used": 11, "remaining": 49 },
  "next": "reviewer: run the 6-lens review; route a11y open_item to @a11y if it fails the lens."
}
```

`@reviewer` starts its run with a **read** for `{ run_id: "...a7f1", to_agent: "@reviewer" }`, gets this envelope (highest `seq` for `@reviewer`), and proceeds from `next` + `open_items` without re-deriving what `@codegen` already decided.

## Anti-patterns

- **Putting a diff in the envelope.** `diff_summary` is one line; the patch lives in the working tree, not the baton. A raw hunk bloats the receiver's context and can smuggle exactly what the summary should redact (`diff-in-envelope` fail mode).
- **Secrets or PII in any field.** Tokens, credentials, customer data — never. The envelope is run state read by multiple agents; treat it as `safety-rails` territory.
- **Caching the envelope.** It is per-stage run state; a cached baton routes the next agent off stale assumptions. (`cacheable: false`.)
- **Letting the envelope grow.** Long prose in `task`/`rationale`/`open_items` erodes the prompt-cache prefix and the receiver's window. Keep every field a summary or a pointer.
- **Overwriting an earlier envelope on retry.** Advance `seq`; never reuse a `<seq>-<from>-to-<to>` key. The history of batons is part of the run record `@supervisor` aggregates.
- **Free-text handoff.** Dropping a paragraph in the scratchpad instead of a structured envelope. Agents compose on the schema, not on prose — that is the whole point of the protocol.
- **Inventing an agent id.** `from`/`to` must be exact roster ids; route to a real agent or escalate to `@supervisor`.
