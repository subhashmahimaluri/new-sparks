---
id: console-ux
title: Orchestrator Console UX Contract
version: 1.0.0
status: canonical
kind: contract
owner: senior-solution-architect
applies_to:
  - /scaffold
  - /review
  - /fix-pentest
  - /contract-sync
  - /refactor-shared
  - /resume
emitted_by: console-render
references:
  - budget-policy
  - cache-policy
  - dedup-policy
  - model-routing-policy
  - path-policy
---

# Orchestrator Console UX Contract

Every orchestrator in eq-sparks prints the **same three-part console** through the
`console-render` skill: an **Intro card**, one **per-stage block** for each stage,
and a **Summary card**. Only the stage list and the agent roster change between
orchestrators — the *shape* never does. This gives the whole platform one
recognisable, reviewable surface that a reviewer can scan in seconds and that any
of the 20–50 developers on the estate can trust regardless of which command they ran.

This is a **contract doc**, not code. `console-render` is the single skill that
materialises these blocks; orchestrators feed it data and never hand-roll box art.
If a console deviates from the ASCII below, `console-render` is the bug — not the
orchestrator.

> Rule of thumb: **Intro once, Stage block per stage, Summary once.** Nothing else
> prints to the console. Rationale, ledgers, and rollback state live in
> `agent-memory` (see `memory-schema`); the console is the human-facing digest.

---

## Why a fixed shape (the buyer's-guide pitch)

- **One mental model.** A developer who has read one `/scaffold` console can read a
  `/fix-pentest` console with zero ramp-up.
- **Reviewable governance.** The `@critic` verdict and `@supervisor` GO/NO-GO always
  land in the same place on the Summary card — no hunting.
- **Cost is always on screen.** The Intro card states the `budget-policy` ceiling up
  front and the Summary card states the spend, so cost is never a surprise. The
  numbers come straight from `budget-check`.
- **Cache and reuse are visible.** `cache-lookup` hits and `dna-precheck` verdicts
  (REUSE / EXTEND / CREATE) are surfaced in-line, so the no-repeat operating model
  is auditable from the transcript alone.

---

## Part 1 — Intro card (run header)

A boxed run header. Printed exactly once, immediately after `@supervisor` plans the
stages and allocates the budget. It declares **what** is about to run, **who** is on
the run, **what tools** are wired, and the **cost / quality envelope**.

```
╔══════════════════════════════════════════════════════════════════╗
║  eq-sparks · SCAFFOLD ORCHESTRATOR                    PBI 38489     ║
╠══════════════════════════════════════════════════════════════════╣
║  Plan (6 stages)                                                   ║
║    0 INITIATE → 1 ADO Fetch → 2 Figma Fetch → 2.5 DNA Pre-Check    ║
║    → 3 Preview → 4 Generate → 5 Review → 6 Summary                 ║
║                                                                    ║
║  Agents on this run                                                ║
║    @supervisor  @decision  @critic                                 ║
║    @mfe  @state  @design-system  @contract  @a11y  @tester         ║
║                                                                    ║
║  Tools (MCP)        ADO ✓   Figma ⏳ (conditional)                 ║
║  Profile            fe-childmfe        IDE   copilot | claude-code  ║
║  Budget             ceiling 60 tool calls · tokens tracked         ║
║  Target confidence  ≥ 90% before "ready to merge"                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### Required fields

| Line | Source | Notes |
|---|---|---|
| **Header** (`eq-sparks · <ORCH> ORCHESTRATOR` + work-item id, right-aligned) | orchestrator id + `ado-context` | Work-item id omitted only for orchestrators with no PBI (e.g. `/refactor-shared`). |
| **Plan (N stages)** | `@supervisor` stage plan | One arrow chain; wraps across lines. Always begins `0 INITIATE`, ends `N Summary`. |
| **Agents on this run** | `@supervisor` | Governance trio first (`@supervisor @decision @critic`), then workers. Use exact ids. |
| **Tools (MCP)** | tool wiring | `ADO ✓` when the ADO MCP is reachable; `Figma ⏳ (conditional)` — pending until Stage 2 resolves the RUNNING-vs-AUTO-SKIPPED decision (see Part 2). |
| **Profile** + **IDE** | `.eq-sparks.yml` profile (see `path-policy`) | IDE shows both adapters today (`copilot | claude-code`); Claude Code is canonical for the POC. |
| **Budget** | `budget-policy` via `budget-check` | The ceiling, stated up front. Format `ceiling <N> tool calls · tokens tracked`. |
| **Target confidence** | orchestrator gate | The self-eval bar from `self-evaluate`; below this, the run is not "ready". |

### Tools/MCP status glyphs

| Glyph | Meaning |
|---|---|
| `✓` | Tool wired and reachable (e.g. ADO MCP via `ado-context`). |
| `⏳ (conditional)` | Tool may run, gated on a later stage decision (e.g. Figma MCP via `figma-context`, gated on a Figma link being present and no skip flag). |
| `—` | Tool not used by this orchestrator. |

---

## Part 2 — Per-stage block

One block per stage, in order. Not boxed (boxes are reserved for Intro and Summary) —
a stage **rule** opens each block. Each block carries: the stage `n/N` title, which
agent/skill **loaded**, a **Status** line, and the stage's **key fields / findings**.

```
── Stage 1/6 — ADO MCP Fetch ──────────────────────────────────────
Loading: @supervisor   Skill: ado-context
Status:  ✅ Cache hit (using cached ADO data)

   Field         Value
   Title         [EQOne] SIP dashboard — add holdings filter
   Parent        UI State Management Modernization (38486)
   Figma links   1 found  → Stage 2 will run
   AC scenarios  7

── Stage 2/6 — Figma MCP Fetch ────────────────────────────────────
Loading: @design-system   Skill: figma-context
Status:  🎯 RUNNING (Figma link present, no skip-figma flag)
   Design context   sip-holdings-filter (3 frames)
   Components       FilterBar, Chip, ResultList  → match to design-system

── Stage 2.5 — DNA Pre-Check ──────────────────────────────────────
Loading: @architect   Skill: dna-precheck
Scanning eq-one-design-system, eq-one-shared, sibling MFEs…
   FilterBar      ✅ exists in design-system → REUSE
   useHoldings    ⚠️ similar store in eq-one-shared → EXTEND (not duplicate)
   ResultList     ➕ new → create in eq-one-sip-mfe
@decision: reuse 1, extend 1, create 1 — rationale logged.
```

### Anatomy of a stage block

1. **Stage rule** — `── Stage n/N — <Title> ` padded with `─` to the 68-col width.
   Use the exact `n/N` from the Intro plan; fractional stages (e.g. `2.5`) are allowed.
2. **Loading line** — `Loading: <@agent>` and, when a skill drives the stage,
   `Skill: <skill-id>`. Always use **exact** agent and skill ids from the roster.
3. **Status line** — see the status vocabulary below. Mandatory on every block.
4. **Key fields / findings** — a two-column `Field / Value` table or a bulleted
   findings list, indented three spaces.

### Status line vocabulary

| Status text | When | Glyph |
|---|---|---|
| `✅ Cache hit (using cached X data)` | `cache-lookup` returned a hit (keyed `skill_id, version, input_hash` per `cache-policy`). State **which** data, e.g. `cached ADO data`. | `✅` |
| `🔄 Cache miss — fetching` | No cache entry; the skill ran for real. | `🔄` |
| `🎯 RUNNING (...)` | A conditional stage that fired. State the reason in parens, e.g. `Figma link present, no skip-figma flag`. | `🎯` |
| `⏭️ AUTO-SKIPPED (...)` | A conditional stage that did **not** fire. State the reason, e.g. `no Figma link` or `--skip-figma`. | `⏭️` |
| `✅ PASS` / `❌ FAIL (n required changes)` | A review/critic stage result. A `@critic` FAIL **blocks** the stage. | `✅` / `❌` |
| `⏸️ BLOCKED — <reason>` | Stage halted pending a `@supervisor` decision or human input. | `⏸️` |

> **Never** cache-skip writes, tests, `self-evaluate`, or LLM completions — those
> stages always show a fetch/run status, never a `Cache hit`. This mirrors
> `cache-policy` exactly; the console must not imply work was skipped that wasn't.

### Two mandatory in-line markers

These two lines are **required** on the relevant stages so the operating model is
auditable from the console alone:

- **DNA pre-check verdicts** — every candidate the `dna-precheck` skill classifies
  prints on its own line with a verdict glyph and tag:

  ```
     FilterBar      ✅ exists in design-system → REUSE
     useHoldings    ⚠️ similar store in eq-one-shared → EXTEND (not duplicate)
     ResultList     ➕ new → create in eq-one-sip-mfe
  ```

  Verdicts follow `dedup-policy` precedence **REUSE > EXTEND > CREATE** and a closing
  `@decision: reuse n, extend n, create n — rationale logged.` summary line. Glyphs:
  `✅` REUSE, `⚠️` EXTEND, `➕` CREATE.

- **Figma RUNNING-vs-AUTO-SKIPPED** — the Figma stage **always** prints one of two
  status lines so the conditional outcome is explicit:

  ```
  Status:  🎯 RUNNING (Figma link present, no skip-figma flag)
  ```
  ```
  Status:  ⏭️ AUTO-SKIPPED (no Figma link in PBI)
  ```

  When AUTO-SKIPPED, the Intro card's `Figma ⏳ (conditional)` is considered resolved
  to "not run" — no `figma-context` call is made and no Figma tokens are spent.

---

## Part 3 — Summary card (final)

A boxed final card. Printed exactly once at the end. It answers the only four
questions a reviewer asks: **Did it meet the ACs? Did it pass governance? What
changed? What did it cost?**

```
╔══════════════════════════════════════════════════════════════════╗
║  ✅ SCAFFOLD COMPLETE — PBI 38489                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Acceptance criteria      7 / 7 mapped        Coverage 100%        ║
║  @critic verdict          PASS (2 revisions)                       ║
║  @supervisor              GO                                       ║
║                                                                    ║
║  Artifacts (.eq-sparks/artifacts/)                                 ║
║    SCAFFOLD-SUMMARY-PBI-38489.md      executive summary            ║
║    IMPLEMENTATION-CHECKLIST.md        AC-by-AC tracking            ║
║    CODE-SNIPPETS.md / generated files                             ║
║                                                                    ║
║  Cross-repo actions                                                ║
║    REUSE   FilterBar (design-system)                               ║
║    EXTEND  useHoldings store (eq-one-shared)                       ║
║    CREATE  ResultList (eq-one-sip-mfe)                             ║
║                                                                    ║
║  Budget used   31 / 60 tool calls · tokens 32K · est. $0.13        ║
║  Confidence    93%        Ready for: developer review              ║
╚══════════════════════════════════════════════════════════════════╝
```

### Required fields

| Line | Source | Notes |
|---|---|---|
| **Header** (`<glyph> <ORCH> COMPLETE` + work-item id) | orchestrator | `✅` on GO, `⛔` on NO-GO. Use `BLOCKED` instead of `COMPLETE` if the run halted. |
| **Acceptance criteria** | AC mapping | `n / N mapped` plus `Coverage P%`. Every AC must be accounted for. |
| **@critic verdict** | `@critic` | `PASS (n revisions)` or `FAIL (n required changes)`. A FAIL means NO-GO. |
| **@supervisor** | `@supervisor` | `GO` or `NO-GO`. The go/no-go call. |
| **Artifacts** | written paths | Relative to `.eq-sparks/artifacts/` per `path-policy`; one line each with a short description. List every file written. |
| **Cross-repo actions** | `dna-precheck` outcome | `REUSE` / `EXTEND` / `CREATE` lines, naming the artifact and target repo. Mirrors the DNA verdicts from Part 2; `@shared-curator` moves move-to-shared items here. |
| **Budget used** | `budget-check` | `used / ceiling tool calls · tokens NK · est. $X.XX` — straight from `budget-policy` tallies. Never omit the cost. |
| **Confidence** + **Ready for** | `self-evaluate` | Final confidence % and the next human action (`developer review`, `merge`, `re-test`, …). Must meet the Intro card's Target confidence to read "ready". |

---

## Cross-orchestrator stage maps (same console, different stages)

Only the stage list and roster change; the three parts are invariant. `console-render`
takes the orchestrator's stage map and renders the identical shape.

| Orchestrator | Command | Stages (besides Intro / Summary) |
|---|---|---|
| **Scaffold** | `/scaffold <PBI>` | ADO Fetch → Figma? → DNA Pre-Check → Preview → Generate → Review |
| **Review** | `/review <PR>` | Fetch diff → 6-lens review → `@critic` → `@supervisor` verdict |
| **Fix pentest** | `/fix-pentest <report>` | Parse findings → Locate (FE/BFF) → Fix → Re-verify |
| **Contract sync** | `/contract-sync <domain>` | Fetch contract → `contract-diff` (drift) → Patch FE types → Re-verify |
| **Refactor shared** | `/refactor-shared` | Scan MFEs → `dna-precheck` (dup detect) → `move-to-shared` → Rewrite importers → Review |
| **Resume** | `/resume <run>` | Load ledger (no ADO/Figma re-fetch) → Skip done stages → Continue → Review |

### Notes that keep every console honest

- **`/resume` never re-fetches.** Its Stage 1 reads the `agent-memory` ledger
  (`memory-schema`) and the console shows `✅ Cache hit (using cached ADO data)` and
  `⏭️ AUTO-SKIPPED (resumed — ledger has Figma context)`; done stages are skipped, not
  re-run. This is the Flow 3 cloud→IDE handoff.
- **`/contract-sync` and `/refactor-shared`** may have no PBI; omit the work-item id
  from the headers and use the orchestrator name alone.
- **`@critic` FAIL blocks the stage.** The per-stage Status shows `❌ FAIL`, the run
  pauses for a revision loop, and the Summary's revision count reflects it. A run that
  cannot clear `@critic` ends with `@supervisor NO-GO` and `⛔` in the Summary header.

---

## Conformance checklist (for `console-render`)

- [ ] Intro card uses the `╔ ╠ ╚` double-line box; Summary card uses the same box.
- [ ] Per-stage blocks use the `── Stage n/N — Title ──` single-rule opener (no box).
- [ ] Box interior width is consistent across Intro and Summary (68 columns).
- [ ] Intro shows: Plan, Agents (governance trio first), Tools/MCP, Profile+IDE,
      Budget ceiling, Target confidence.
- [ ] Every stage has a Status line; cache hits name the data and never cover
      writes/tests/`self-evaluate`/LLM completions.
- [ ] DNA verdicts print REUSE/EXTEND/CREATE with the `@decision` rationale line.
- [ ] The Figma stage prints exactly one of RUNNING / AUTO-SKIPPED with a reason.
- [ ] Summary shows: ACs+coverage, `@critic` verdict (n revisions), `@supervisor`
      GO/NO-GO, artifacts, cross-repo actions, Budget used (calls/tokens/$),
      Confidence, Ready-for.
- [ ] Exact ids only — every `@agent`, skill, and `/command` reference is from the
      canonical roster.

> Every orchestrator emits exactly these three parts. Only the stage list and agent
> roster change. That is the contract.
