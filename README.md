# eq-sparks

The central agentic-harness monorepo for the Equiniti (EQ) frontend + BFF estate. **eq-sparks** holds every agent, orchestrator, skill, and guardrail — plus the hidden "agentic OS" (cache, budget, memory) — and syncs into each consumer repo behind a gitignored `.eq-sparks/` folder. Developers only ever see clean subagents and slash-command orchestrators through Claude Code; the runtime stays out of the way. The whole point is **strong output under budget**: a Haiku-first model ladder, aggressive caching, and no repeated work, governed by the trio of `@supervisor`, `@decision`, and `@critic`.

> You author once in the canonical source; two renderers project it into the formats the IDEs read —
> **Claude Code** (`.claude/`) and **GitHub Copilot** (`.github/`). Both are built and working.

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
└─ .eq-sparks/             # consumer-only: synced harness OS + runtime — GITIGNORED (read on disk)
                           #   shared/ methodology/ profiles/ skills/ instructions/ + cache/ agent-memory/ telemetry/
```

**Render:** `node bin/render-claude.mjs` regenerates `.claude/`, and `node bin/render-copilot.mjs` regenerates `.github/`, from the canonical source.

In a **consumer repo**, the CLI also syncs the full harness OS (`shared/`, `methodology/`, `profiles/`, `skills/`, `instructions/`) **plus** the runtime (cache, agent-memory, telemetry) into `.eq-sparks/`, and rewrites the rendered agents to read it there (`.eq-sparks/shared/…`). The whole `.eq-sparks/` folder is gitignored and **never committed** — but the agents still read those files on disk. (The central repo above keeps the OS at the top level; only a consumer gets the `.eq-sparks/` copy.)

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

> **Don't copy the `[brackets]` from any doc into your terminal.** In zsh, `[...]` is a
> filename pattern, so a line like `init [--ide=copilot]` fails with `zsh: no matches found`.
> Every command below is real — paste it exactly as written.

### Right now (the repo isn't published to GitHub yet)

Run the local installer **from inside the repo you want to set up** (replace the path with
where you cloned eq-sparks):

```sh
# Full install — both Claude Code and Copilot
node /path/to/eq-sparks/install.js --profile=fe-childmfe

# Copilot only, offline (no .eq-sparks runtime, no sync ever needed)
node /path/to/eq-sparks/install.js --profile=fe-childmfe --ide=copilot --offline-only
```

Prefer a real `eq-sparks` command? Run `npm link` once inside the eq-sparks repo, then from
any repo:

```sh
eq-sparks init --profile=fe-childmfe
```

### Once we publish eq-sparks to GitHub (MANUAL-STEPS D7)

```sh
npx github:<org>/eq-sparks init --profile=fe-childmfe
```

### The flags

- `--profile=` — one of `fe-rootmfe`, `fe-childmfe`, `fe-shared`, `fe-designsystem`, `be-experienceapi`
- `--ide=` — `claude`, `copilot`, or `claude,copilot` (default: both)
- `--offline-only` — Copilot-only, no `.eq-sparks/` runtime, install/update on demand (no sync)

### Staying up to date

- `eq-sparks sync` — re-render to pick up new agents/guardrails (full mode; opens a PR, never overwrites silently)
- `eq-sparks update --offline-only` — re-render in place (offline mode; no network, no PR)

`install.js` / `install.sh` bootstrap the CLI in [`cli/eq-sparks.mjs`](./cli/eq-sparks.mjs).

---

## Where to read next

**New here? Read these first — they're written for people, not machines:**

| Doc | What it covers |
| --- | --- |
| [`DEVELOPER-GUIDE.md`](./DEVELOPER-GUIDE.md) | **Start here.** What this is in plain English, how to install it, how to use it day to day, and how to fix common errors. |
| [`SAMPLE-PROMPTS.md`](./SAMPLE-PROMPTS.md) | Copy-paste prompts for every orchestrator and agent — in both Claude Code and Copilot. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How the whole thing fits together, with diagrams and a worked example of one run. |

**Reference / deep-dive:**

| Doc | What it covers |
| --- | --- |
| [`CLAUDE.md`](./CLAUDE.md) | How Claude operates in this repo: conventions, the governance flow, authoring rules. |
| [`methodology/`](./methodology/) | The execution method: the autoresearch (A-Rag) loop and the agent→agent handoff protocol. |
| [`MODEL-AND-BUDGET-STRATEGY.md`](./MODEL-AND-BUDGET-STRATEGY.md) | The cost/quality operating model — Haiku-first ladder, escalation triggers, caching, no-repeat. |
| [`SCHEMA.md`](./SCHEMA.md) | Frontmatter and file schemas for agents, skills, and commands. |
| [`MANUAL-STEPS.md`](./MANUAL-STEPS.md) | One-time setup that can't be automated (MCP auth, workspace wiring). |
| [`EQ-SPARKS-POC-PLAN.md`](./EQ-SPARKS-POC-PLAN.md) | The POC scope, milestones, and acceptance criteria. |
