# Manual steps for the owner

Everything in `eq-sparks` that an agent or orchestrator can decide, it already does. This page is the short list of **human-only** calls — the things that need *your* authority (an endpoint, a credential, an org decision) before the platform is fully wired. It is derived from `EQ-SPARKS-POC-PLAN.md` §13 plus what this foundation now physically needs to run.

How to read it:

- **DECISIONS TO CONFIRM** — judgement/authority calls only you can make. Each sets a config value or unblocks a downstream action.
- **ACTIONS TO DO** — concrete setup tasks (mostly one-time, mostly local).
- **🚧 BLOCKER** — the Phase-2 `/scaffold` demo **cannot run end-to-end** until this is resolved. Everything else is "should-fix" but the demo will still move.

> Scope note: do **not** put secrets in any repo file. Tokens/PATs live in your local credential store, the MCP browser sign-in, or the platform secret store referenced by `safety-rails` — never in `mcp.json`, `.eq-sparks.yml`, or git.

---

## DECISIONS TO CONFIRM

### D1 — ADO MCP + Figma MCP endpoints: official vs internal EQ-hosted 🚧 BLOCKER
**The call:** Are `ado-context` (MCP:ado) and `figma-context` (MCP:figma) pointed at the **official Microsoft ADO MCP / Figma MCP** servers, or **internal EQ-hosted** ones?
**Why it matters:** This sets the server URLs and the auth model in `.vscode/mcp.json` (see A1). Official servers use the standard browser OAuth sign-in; internal EQ-hosted servers may need a private URL, a VPN/network path, and a different token scheme.
**Blocked until answered:** The `ado-context` and `figma-context` skills have no live source. `/scaffold` opens by fetching the PBI via `ado-context` and any Figma URL via `figma-context` — with no endpoint, the flagship demo cannot start. This is the single highest-priority decision.

### D2 — eq-one-studio as the source Storybook + agent access
**The call:** Confirm `eq-one-studio` is the Storybook that `eq-one-design-system` re-exports, and decide how agents read it (published package, local checkout, or hosted Storybook URL).
**Why it matters:** `@design-system` blocks hand-rolled UI by proving the component already exists in the design system; it needs a readable inventory of what `eq-one-studio` provides.
**Blocked until answered:** `@design-system` can still enforce against `eq-one-design-system` exports in the workspace, so the demo runs — but its "consume, don't hand-roll" decisions are weaker until the studio source is reachable. Should-fix, not a demo blocker.

### D3 — Repo cloning convention: all repos siblings under one parent 🚧 BLOCKER
**The call:** Confirm developers clone **all** EQ repos (`eq-nexus-ui`, `eq-one-saye-mfe`, `eq-one-sip-mfe`, `eq-one-shares-mfe`, `eq-one-shared`, `eq-one-design-system`, `ExperienceAPI`, and `eq-sparks`) as **siblings under one parent folder**.
**Why it matters:** The multi-root `eq-one.code-workspace` and every cross-repo `../` path the agents use (`@architect` placement, `@shared-curator` / `move-to-shared`, `@contract` / `contract-diff`) assume this flat sibling layout. If clones live in scattered locations, we need a discovery/config step instead.
**Blocked until answered:** Cross-repo agents resolve paths to nothing — `dna-precheck` can't scan sibling repos for reuse, `move-to-shared` can't rewrite importers, and `/scaffold` can't decide where code belongs. Confirm the convention (or commission the discovery step) before the demo.

### D4 — ExperienceAPI contract format: OpenAPI/Swagger per domain
**The call:** Confirm each `src/domains/<name>/` publishes its contract as **OpenAPI/Swagger**.
**Why it matters:** `@contract-publisher` emits it and FE `@contract` (via `contract-diff`) syncs against it; the whole FE↔BFF drift gate assumes this format.
**Blocked until answered:** `/contract-sync` and the `contract-diff` skill have no defined shape to diff. If the demo includes a BFF/contract leg, this is a blocker for that leg; for a FE-only `/scaffold` demo it is should-fix.

### D5 — Module-federation mechanism for @mfe
**The call:** Is the `eq-nexus-ui` RootMFE wiring **Module Federation**, **single-spa**, or another approach?
**Why it matters:** `@mfe` scaffolds child MFEs (`eq-one-saye-mfe` / `eq-one-sip-mfe` / `eq-one-shares-mfe`) and wires them into the shell against the exact federation contract. Wrong mechanism = scaffold that won't load in the shell.
**Blocked until answered:** If the `/scaffold` demo creates or extends an MFE, `@mfe` can't produce correct wiring — blocker for that path. If the demo target is shared/BFF only, should-fix.

### D6 — Budget ceiling: is 60 tool-calls right?
**The call:** Confirm **60 tool-calls per run** as the POC default ceiling (or set higher/lower).
**Why it matters:** `@supervisor` allocates against this and the `budget-check` skill tallies tool-calls + tokens against it (per `budget-policy`). Too low and `/scaffold` aborts mid-run; too high and the cost story is undersold.
**Blocked until answered:** Not a hard blocker — `budget-check` reads the value from `.eq-sparks.yml`, so a default works for the demo. But confirm before the demo so `@supervisor`'s go/no-go calls reflect a real ceiling.

### D7 — eq-sparks GitHub org/owner + who approves shared agents/guardrails
**The call:** Which GitHub **org/owner** hosts the central `eq-sparks` repo, and **who approves** changes to shared agents and the guardrail docs (`budget-policy`, `model-routing-policy`, `dedup-policy`, `safety-rails`, `path-policy`, `cache-policy`, `memory-schema`)?
**Why it matters:** Sets the remote and the CODEOWNERS/review gate for the sync-into-consumer-repos distribution model. Guardrails are platform-wide; uncontrolled edits undermine the cost/quality operating model. The same `<org>/eq-sparks` is what consumers run via `npx github:<org>/eq-sparks` — confirm it here so distribution (A7) has a fixed source.
**Blocked until answered:** Not a demo blocker — `/scaffold` runs from a local clone. Needed before the platform is shared with the 20–50 dev team.

### D8 — Confirm Copilot `.github/` file conventions match your Copilot Enterprise setup (should-fix verify)
**The call:** The render now follows VS Code's documented custom-agents convention (verified against the VS Code + GitHub Copilot docs): orchestrators → `.github/agents/*-orchestrator.agent.md` (top-level, `user-invocable: true` — these appear in the Agents dropdown), sub-agents → `.github/agents/<category>/*.agent.md` (`user-invocable: false`, registered in `.vscode/settings.json` via `chat.agentFilesLocations`), skills → `.github/skills/<id>/SKILL.md`, instructions → `.github/instructions/*.instructions.md` (`applyTo: "**"`). **Two things to verify in your Copilot Enterprise build:** (a) it detects sub-agents in the subfolders — the `chat.agentFilesLocations` setting is written for you, but older builds may only scan the top level (if so we flatten sub-agents to the root); (b) the `tools:` values — the render passes through the canonical tool names, so map them to your Copilot tool/tool-set catalog if your build validates them strictly.
**Why it matters:** `.github/` is **generated** from canonical — if Copilot Enterprise expects different paths/extensions, the rendered agents/orchestrators won't be discovered by Copilot and the fix is in the renderer, not the generated files.
**Blocked until answered:** Not a demo blocker — Claude Code is the canonical, runnable target for Phase 2 (see A5). Verify before Copilot-based developers rely on the `.github/` render.

---

## ACTIONS TO DO

### A1 — Create the multi-root workspace + single `mcp.json` 🚧 BLOCKER
Create `eq-one.code-workspace` (multi-root: all sibling repos from D3 as folders) and a **single** `.vscode/mcp.json` declaring the **ado** and **figma** servers, using the URLs/auth chosen in D1.
**Why it matters:** This is the surface agents actually operate over — without the multi-root workspace the `../` cross-repo paths don't resolve, and without `mcp.json` the `ado-context` / `figma-context` skills have no servers.
**Blocked until done:** `/scaffold` can't fetch ADO or Figma context. Depends on D1 + D3. Demo blocker.

### A2 — Sign in to ADO + Figma MCP via browser 🚧 BLOCKER
Run the MCP browser sign-in for both servers so the live tokens land in your local credential store (not in any repo file).
**Why it matters:** `ado-context` and `figma-context` need an authenticated session to return work-item and design context.
**Blocked until done:** First `/scaffold` `ado-context` call fails auth. Depends on A1. Demo blocker.

### A3 — Fill `.eq-sparks.yml` from the example (incl. ADO org/project) 🚧 BLOCKER
Copy the example config to `.eq-sparks.yml` and fill the real values: ADO **org** + **project**, repo roots (from D3), the budget ceiling (D6), and contract format (D4).
**Why it matters:** This is the run config the platform reads — `ado-context` needs org/project to resolve a PBI id, `budget-check` reads the ceiling, and path-aware agents read the repo roots (`path-policy`).
**Blocked until done:** `/scaffold <pbi-id>` can't resolve the work item or enforce budget. Demo blocker.

### A4 — Decide whether to enable opt-in cross-run cache
Set the `cache-policy` opt-in flag for **cross-run** caching of stable PBI metadata in `.eq-sparks.yml`.
**Why it matters:** Speeds up `/resume` and repeat runs on the same PBI by reusing stable ADO metadata across runs. Per `cache-policy`, only stable metadata is ever cross-run cached — writes/tests/self-eval/LLM completions are **never** cached, regardless of this flag.
**Blocked until done:** Nothing — defaults to off and the demo runs fine. Pure cost optimisation; safe to turn on once you've seen one clean run.

### A5 — Commission the Copilot `.github/` adapter render (fast-follow)
Schedule the adapter that renders the canonical Claude Code artifacts into the Copilot `.github/` format.
**Why it matters:** Claude Code is canonical and runnable now; the `.github` render is the explicitly-stated fast-follow so Copilot-based developers get the same agents/orchestrators.
**Blocked until done:** Nothing for this POC — Claude Code format is the canonical, runnable target for the Phase-2 demo. Post-demo deliverable.

### A6 — Provision NewRelic + flip the telemetry sink (only when ready)
Provision the NewRelic account and supply `account_id` + license key via **ENV / the platform secret store** (never committed — same rule as `safety-rails`). Then, and only then, set `telemetry.sink: newrelic` and `newrelic.enabled: true` in `.eq-sparks.yml`.
**Why it matters:** Agents emit one JSONL event per action against the telemetry schema; `@infra` reads whichever sink is active and surfaces run telemetry/cost/health to `@supervisor` and the console. NewRelic is the pluggable production sink for cross-run observability and the `@learner` curated-learning loop.
**Blocked until done:** Nothing. The **default local JSONL sink** (`.eq-sparks/telemetry/<run-id>.jsonl`) is authoritative and works **today** — `telemetry.sink: local` with `newrelic.enabled: false` ships by default, so `@infra` and `@learner` run without NewRelic. Pure observability upgrade; flip the sink only once the account is live. Not a demo blocker.

### A7 — Wire distribution: confirm the `npx github:<org>/eq-sparks` source + set `EQ_SPARKS_PROFILE` in consumer repos
Once D7 fixes the GitHub **org/owner**, confirm consumers bootstrap via `npx github:<org>/eq-sparks` (init/sync/update). In **each consumer repo**, set the repo variable **`EQ_SPARKS_PROFILE`** that `templates/consumer/eq-sparks-sync.yml` reads, so the sync workflow renders that repo's profile subset.
**Why it matters:** This is the distribution path that gets the platform onto the 20–50 dev team's repos. `EQ_SPARKS_PROFILE` selects which profile's agents/orchestrators/skills the CLI renders into each consumer (`--profile`); without it the sync workflow has no profile to render.
**Blocked until done:** Nothing for the demo — `/scaffold` runs from a local clone. Needed before consumer repos auto-sync from central `eq-sparks`. Depends on D7. Post-demo distribution step.

---

## Demo-readiness checklist (the blocker set)

The Phase-2 `/scaffold` demo is **go** once these are resolved, in order:

- [ ] **D1** — ADO + Figma MCP endpoints chosen
- [ ] **D3** — sibling-repo cloning convention confirmed
- [ ] **A1** — `eq-one.code-workspace` + `.vscode/mcp.json` created (needs D1, D3)
- [ ] **A2** — browser sign-in done for both MCP servers (needs A1)
- [ ] **A3** — `.eq-sparks.yml` filled incl. ADO org/project (needs D3)
- [ ] **D4 / D5** — required **only if** the demo touches the BFF/contract leg (D4) or creates/extends an MFE (D5)

Everything else (D2, D6, D7, D8, A4, A5, A6, A7) is should-fix or post-demo and does **not** hold the demo.
