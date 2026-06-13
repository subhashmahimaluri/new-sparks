# eq-sparks

The central agentic-harness monorepo for the Equiniti (EQ) frontend + BFF estate. **eq-sparks** holds every agent, orchestrator, skill, and guardrail — plus the hidden "agentic OS" (cache, budget, memory) — and syncs into each consumer repo behind a gitignored `.eq-sparks/` folder. Developers only ever see clean subagents and slash-command orchestrators through Claude Code; the runtime stays out of the way. The whole point is **strong output under budget**: a Haiku-first model ladder, aggressive caching, and no repeated work, governed by the trio of `@supervisor`, `@decision`, and `@critic`.

> For this POC, **Claude Code format is canonical and runnable now**. A Copilot `.github` renderer is a fast-follow.

---

## Directory map

```
eq-sparks/                 # CANONICAL SOURCE — edit here, never .claude/ or .github/
├─ agents/                 # 26 sub-agents by layer: <layer>/<id>.md
│  ├─ governance/          #   supervisor, decision, critic
│  ├─ core/                #   architect, codegen, reviewer, tester, …
│  ├─ frontend/            #   mfe, design-system, state, contract, a11y, …
│  ├─ bff/                 #   bff-shaper, downstream-connector, contract-publisher
│  └─ platform/            #   infra, db, learner
├─ skills/                 # <id>/SKILL.md: dna-precheck, self-evaluate, handoff, …
├─ orchestrators/          # <id>.md: scaffold, review, fix-pentest, contract-sync, …
├─ methodology/            # the execution method: autoresearch-loop, handoff-protocol
│
├─ shared/                 # the "agentic OS"
│  ├─ guardrails/          #   guardrails-registry (G1–G15+), budget-policy,
│  │                       #   model-routing-policy, dedup-policy, safety-rails,
│  │                       #   path-policy, cache-policy, memory-schema
│  ├─ memory/              #   memory-schema + templates/ (scratchpad, ledger, …)
│  ├─ telemetry/           #   the observability sink schema (local JSONL | NewRelic)
│  └─ integrations/        #   MCP / external wiring
│
├─ console/                # the standardised three-part orchestrator console
├─ instructions/           # authoring + contributor guidance
├─ profiles/               # install profiles (which agents/skills a repo gets)
├─ templates/consumer/     # files seeded into a consumer repo on init (.eq-sparks.yml, …)
│
├─ cli/eq-sparks.mjs       # the CLI: init / sync / update (--profile/--ide/--offline-only)
├─ install.js, install.sh  # bootstrap the CLI; package.json exposes it via npx
├─ bin/render-claude.mjs   # generator: canonical source → .claude/
├─ bin/render-copilot.mjs  # generator: canonical source → .github/ (Copilot)
├─ .claude/, .github/      # GENERATED — what the IDEs load. NEVER edit by hand.
│
└─ .eq-sparks/             # the agentic OS runtime — GITIGNORED in consumers
                           #   (cache, budget tallies, telemetry/, run logs, agent-memory)
```

**Render:** `node bin/render-claude.mjs` regenerates `.claude/`, and `node bin/render-copilot.mjs` regenerates `.github/`, from the canonical source.

The `.eq-sparks/` runtime is rendered into consumer repos and **never committed there** — it is purely operational state for the cache, budget, and memory pillars.

---

## Quickstart (developer)

1. **Open the multi-root workspace** that spans `eq-nexus-ui`, the child MFEs, `eq-one-shared`, `eq-one-design-system`, and the `ExperienceAPI` BFF.
2. **MCP connects once** — the ADO and Figma MCP servers (used by `ado-context` and `figma-context`) authenticate at the start of the session, not per run.
3. **Run the flagship orchestrator:**

   ```
   /scaffold <PBI>
   ```

   This turns an Azure DevOps PBI into a cross-repo-aware, governed scaffold: `@supervisor` plans the stages and budget, workers run `dna-precheck` before generating and `self-evaluate` before handing off, and `@critic` gates each stage PASS/FAIL.

Other commands: `/review`, `/fix-pentest`, `/contract-sync`, `/refactor-shared`, and `/resume` (cloud → IDE handoff without re-fetching ADO/Figma).

---

## Install

A consumer repo opts in once via `npx`, then re-renders on demand:

```
npx github:equiniti-org/eq-sparks init --profile=<p> [--ide=claude,copilot] [--offline-only]
```

- `init` seeds `templates/consumer/` (e.g. `.eq-sparks.yml`), renders the selected `profiles/<p>` into the repo for each `--ide` (`.claude/` and/or `.github/`), and wires up the gitignored `.eq-sparks/` runtime. `--ide` defaults to `claude`.
- `sync` re-renders to pick up new agents, skills, or guardrail updates.
- `update` upgrades the pinned eq-sparks version, then re-renders.
- `--offline-only` installs from the bundled snapshot — no network, **no `sync` needed**.

`install.js` / `install.sh` bootstrap the CLI (`cli/eq-sparks.mjs`); `package.json` exposes it via `npx`.

---

## Where to read next

| Doc | What it covers |
| --- | --- |
| [`CLAUDE.md`](./CLAUDE.md) | How Claude operates in this repo: conventions, the governance flow, authoring rules. |
| [`methodology/`](./methodology/) | The execution method: the autoresearch (A-Rag) loop and the agent→agent handoff protocol. |
| [`MODEL-AND-BUDGET-STRATEGY.md`](./MODEL-AND-BUDGET-STRATEGY.md) | The cost/quality operating model — Haiku-first ladder, escalation triggers, caching, no-repeat. |
| [`SCHEMA.md`](./SCHEMA.md) | Frontmatter and file schemas for agents, skills, and commands. |
| [`MANUAL-STEPS.md`](./MANUAL-STEPS.md) | One-time setup that can't be automated (MCP auth, workspace wiring). |
| [`EQ-SPARKS-POC-PLAN.md`](./EQ-SPARKS-POC-PLAN.md) | The POC scope, milestones, and acceptance criteria. |
