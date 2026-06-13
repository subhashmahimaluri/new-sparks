---
id: lessons
title: Curated Cross-Run Lessons (seed)
kind: memory
version: 0.1.0
status: seed
schema: memory-schema
---

# Curated Cross-Run Lessons (seed)

This file holds **human-curated, profile-tagged durable patterns** — the small set
of hard-won lessons that have proven worth carrying across runs, repos, and teams.

It is **not** raw telemetry and **not** a scratchpad. Run-scoped state lives in the
idempotent task ledger (see `memory-schema`); the opt-in cross-run cache (see
`cache-policy`) holds stable PBI metadata. This file is the **slowest-moving,
highest-trust** layer: a lesson only earns a place here once a human has reviewed it.

## Promotion rules (how a lesson gets in)

A candidate becomes a lesson **only when ALL of these hold**:

1. **3+ confirming telemetry runs.** A pattern observed in fewer than three runs is
   noise, not a lesson. Cite the run ids in **Source telemetry**.
2. **Human curation.** A reviewer (named in **Added**) reads the runs, confirms the
   pattern is real (not a coincidence of one PBI or one repo), and writes it up.
3. **Profile-tagged.** Every lesson declares the **Profile** it applies to (e.g.
   `frontend:mfe`, `bff:domain`, `governance`, `all`) so agents only load lessons
   relevant to the work in front of them. Untagged lessons are rejected.
4. **Guardrail-aligned.** A lesson must not contradict `budget-policy`,
   `model-routing-policy`, `dedup-policy`, `safety-rails`, `path-policy`, or
   `cache-policy`. If it does, the guardrail wins and the lesson is reworked or dropped.

Lessons are **append-only and durable**. Removing or rewriting one requires the same
human-review bar. No agent writes here automatically — only the maintainer commits
curated lessons after the bar above is met.

## How agents use this file

- Build agents (e.g. `@mfe`, `@domain-folder`, `@codegen`, `@shared-curator`) read the
  lessons matching their Profile **during `dna-precheck`**, before generating, so a
  prior team's reuse/placement decision is not relearned the hard way.
- Governance agents (`@architect`, `@critic`, `@decision`) cite a lesson id when a
  past pattern justifies a placement, reuse-vs-create call, or PASS/FAIL.
- Reading lessons is cheap and **cacheable** (stable prefix; see `cache-policy`).
  Writing lessons is a human act and is never cached.

## Format

Each lesson is one fixed-shape block. Fields, in order:

- **id** — kebab/serial id, `L-NNN`.
- **Profile** — the tag(s) the lesson applies to.
- **Pattern** — the durable, actionable statement: what to do (or avoid) and why.
- **Source telemetry** — the run ids (3+) that confirmed it.
- **Added** — `YYYY-MM-DD` + author.

---

## Lessons

> **No real lessons yet.** This section fills during the POC as telemetry accrues.
> The block below is a **TEMPLATE / EXAMPLE ONLY** (`L-000`). It is illustrative — do
> not treat it as an active lesson and do not let agents act on it.

### L-000 — TEMPLATE / EXAMPLE (do not action)

- **id:** L-000
- **Profile:** `frontend:mfe`
- **Pattern:** When a child MFE (`eq-one-saye-mfe` / `eq-one-sip-mfe` /
  `eq-one-shares-mfe`) needs a layout, auth, or API-client helper that already exists
  in another child MFE, `dna-precheck` should resolve to **REUSE/EXTEND from
  `eq-one-shared`**, not CREATE a local copy. If the helper lives in only one MFE
  today, `@shared-curator` runs `move-to-shared` first, then the consuming MFE imports
  from `eq-one-shared`. Honours `dedup-policy` precedence REUSE > EXTEND > CREATE and
  keeps duplicate UI logic out of independent MFEs.
- **Source telemetry:** `run-0000-aaaa`, `run-0000-bbbb`, `run-0000-cccc` (example ids — not real runs)
- **Added:** 2026-06-13 — Platform Architect (example author; replace on first real lesson)
