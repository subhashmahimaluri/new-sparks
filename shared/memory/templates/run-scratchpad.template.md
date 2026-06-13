<!--
  TEMPLATE — Layer-1 per-run scratchpad (copy-ready).
  Canonical runtime location: .eq-sparks/agent-memory/<run-id>/scratchpad.md  (gitignored).
  This template is committed; the agent COPIES it at run start and replaces every <placeholder>.
  Contract: shared/memory/memory-schema.md (Layer 1). Path discipline: shared/guardrails/path-policy.md.
  Layer 1 is VOLATILE and NEVER cached (it changes every turn — see shared/memory/cache-policy.md).
  Each section below carries one example line so it is immediately copy-ready; delete the examples once filled.
-->
---
run_id: <run-id>                      # globally unique; MUST equal the <run-id> segment of the path .eq-sparks/agent-memory/<run-id>/scratchpad.md  e.g. 2026-06-13-scaffold-PBI-48213-a7f1
pbi_id: <pbi-id>                      # ADO work-item id (from ado-context); null for non-PBI runs  e.g. 48213
profile: <profile>                    # one of: fe-rootmfe | fe-childmfe | fe-shared | fe-designsystem | be-experienceapi  e.g. fe-childmfe
agent: "<@agent-id>"                  # exact roster id owning this scratchpad section  e.g. "@mfe"
started_at: <iso-8601-utc>            # ISO-8601 UTC  e.g. 2026-06-13T09:14:22Z
---

# Run scratchpad — <run-id>

> Working memory for ONE run. Sections are in the order fixed by `memory-schema.md` §"Sections".
> The `/resume` orchestrator reads this file (Decision + Task ledger) to continue exactly where the run stopped — without re-fetching ADO or Figma.

## Hypothesis (initial)

<one short paragraph: what the agent believes the task is and how it intends to approach it, BEFORE doing work. Restate the task in one sentence + list assumptions. Never invent requirements.>

_Example:_ Wire the new `saye` child MFE into the `eq-nexus-ui` shell and surface a balance summary card; I expect the balance store and shape already exist in `eq-one-shared` (REUSE) and only the route + card are new (CREATE).

## Investigation log

<append-only, timestamped bullets: repos/files inspected (cite REAL paths), dna-precheck verdicts, cache-lookup hit/miss, contract-diff results. This is the audit trail @critic and humans read. Read through the cache (cache-lookup); do not bulk-read the repo.>

- `<iso-8601-utc>` — <what was inspected / searched / verified, with concrete path or skill output>
  _Example:_ `2026-06-13T09:16:40Z` — dna-precheck: `eq-one-shared/src/stores/useBalanceStore.ts` exists → classify `saye-balance-store` REUSE; cache-lookup(dna-precheck) HIT.

## Decisions

<any @decision fork resolved during the run (vague PBI, missing contract, code placement, reuse-vs-create) WITH rationale + confidence, recorded for human review. Mirror the @decision log entry here so a /resume re-applies it rather than re-deciding.>

- fork: `<what had to be decided>` → choice: `<chosen option>` — rationale: `<why>` (confidence: `<0.0–1.0>`)
  _Example:_ fork: `summary card placement` → choice: `create in saye MFE, do NOT promote to eq-one-shared yet` — rationale: single consumer today; promote later via @shared-curator if a 2nd MFE needs it (confidence: 0.82)

## Self-eval result

<the self-evaluate / self-assess output BEFORE handoff, as checkbox criteria. Mark each Done-Criterion PASS/FAIL with concrete evidence, then an overall confidence (0.0–1.0). A score < 0.7 is the documented trigger to escalate ONE model rung (model-routing-policy); record the escalation here if it happened. read-only/gate/planning agents self-ASSESS completeness; do NOT run the diff-based self-evaluate (an empty diff must never read as FAIL).>

- [ ] `<done-criterion 1>` — <PASS|FAIL>: <evidence>
- [ ] `<done-criterion 2>` — <PASS|FAIL>: <evidence>

_Example:_
- [x] `Route renders saye MFE in shell` — PASS: `eq-nexus-ui/src/routes/saye.tsx` added; smoke test green.
- [x] `No duplicated balance store` — PASS: imports `useBalanceStore` from `eq-one-shared`, none re-declared.

Overall confidence: `<0.0–1.0>`   _Example:_ 0.88
Escalation: `<none | one-rung → <model>, reason: ...>`   _Example:_ none

## Task ledger

<The idempotent ledger is the resume gate and lives in the SIBLING machine-readable file — see ./ledger.jsonl (.eq-sparks/agent-memory/<run-id>/ledger.jsonl). One JSON line per task: {task_id, content_hash, status: done|pending|blocked, agent, ts}. /resume skips status:done. classification follows REUSE > EXTEND > CREATE (dedup-policy). Keep this section as a POINTER only — do not duplicate the ledger here.>

Pointer: `./ledger.jsonl`
_Example line (in ledger.jsonl):_ `{"task_id":"saye-route-wiring","content_hash":"9f3c...","status":"done","agent":"@mfe","ts":"2026-06-13T09:21:05Z"}`

## Outcome

<final state when the agent hands off, plus a one-line summary and any follow-ups for the next stage. Then EMIT a handoff envelope (handoff skill) to the next agent / @supervisor: .eq-sparks/agent-memory/<run-id>/handoff/<seq>-<from>-to-<to>.json>

- status: `<complete | blocked | escalated | handoff>`
- summary: `<one line>`
- follow-ups / open items: `<for the next stage, or "none">`
- handoff envelope: `<path under handoff/, or "n/a">`

_Example:_
- status: `handoff`
- summary: saye route + summary card created; balance store reused from eq-one-shared; ready for @reviewer.
- follow-ups / open items: none
- handoff envelope: `./handoff/0003-mfe-to-reviewer.json`
