# eq-sparks profiles

A **profile** binds a target repo to the exact slice of the 23-agent roster, the
skills, and the orchestrators that make sense for that repo type — plus the
shared cost guardrails (model caps, budget ceiling, caching). When a run is
scoped to a repo, the platform loads its profile so `/scaffold`, `/review`, and
friends only ever spin up the agents that belong there. This keeps the
haiku-first ladder honest and stops a child MFE from, say, scaffolding a BFF
domain folder.

## How these map to the coarse profiles

Per **EQ-SPARKS-POC-PLAN.md section 6**, every repo first resolves to one of two
**coarse** profiles — `ui` or `backend`. The four FE sub-profiles below all
**refine the coarse `ui` profile** (each narrows the roster to its repo's real
job — shell wiring vs. feature code vs. shared library vs. design-system
facade), and **`be-experienceapi` maps to the coarse `backend` profile**.

| Profile | maps_to_today | Repo(s) | Agents pulled in (exact ids) | Orchestrators |
|---|---|---|---|---|
| `fe-rootmfe` | `ui` | `eq-nexus-ui` (RootMFE / shell) | @supervisor, @decision, @critic, @architect, @mfe, @design-system, @contract, @reviewer, @tester, @a11y, @scanner, @docs | `/scaffold`, `/review`, `/contract-sync`, `/resume` |
| `fe-childmfe` | `ui` | `eq-one-saye-mfe` / `eq-one-sip-mfe` / `eq-one-shares-mfe` | @supervisor, @decision, @critic, @mfe, @state, @design-system, @contract, @a11y, @codegen, @reviewer, @tester, @scanner, @docs | `/scaffold`, `/review`, `/contract-sync`, `/refactor-shared`, `/resume` |
| `fe-shared` | `ui` | `eq-one-shared` | @supervisor, @decision, @critic, @shared-curator, @state, @codegen, @reviewer, @tester, @scanner, @docs | `/refactor-shared`, `/review`, `/scaffold`, `/resume` |
| `fe-designsystem` | `ui` | `eq-one-design-system` | @supervisor, @decision, @critic, @design-system, @a11y, @reviewer, @tester, @docs | `/scaffold`, `/review`, `/resume` |
| `be-experienceapi` | `backend` | `ExperienceAPI` | @supervisor, @decision, @critic, @architect, @domain-folder, @bff-shaper, @downstream-connector, @contract-publisher, @contract-tester, @integration-tester, @security, @reviewer, @tester, @scanner, @docs | `/scaffold`, `/review`, `/contract-sync`, `/fix-pentest`, `/resume` |

## What's the same across every profile

These are constants regardless of repo, so the cost/quality operating model
behaves identically everywhere:

- **Platform skills (always present):** `dna-precheck`, `self-evaluate`,
  `cache-lookup`, `console-render`, `budget-check`. Build agents run
  `dna-precheck` first (reuse > extend > create) and `self-evaluate` last;
  fetch/scan agents go through `cache-lookup`.
- **Model caps:** `default_tier: sonnet`, `max_tier: opus`,
  `allow_escalation: true` — escalate ONE rung only on low self-eval confidence
  (< 0.7) or two `@critic` FAILs; logged + budgeted, never auto-downgraded
  (per **model-routing-policy**).
- **Budget:** `max_iterations: 5`, `cost_cap_usd: 2.0`, `tool_budget: 60`
  (per **budget-policy**, enforced via `budget-check`).
- **Cache:** `per_run: true`, `cross_run: false` — the per-run skill-output
  cache is on; cross-run is opt-in only for stable PBI metadata (per
  **cache-policy**).
- **Paths:** every profile carries a `paths_allowlist` / `paths_denylist` scoped
  to its repo type, and all of them deny `.eq-sparks/` and `**/*.env*`
  (per **path-policy** and **safety-rails**).

## Why the FE rosters differ

The four `ui` sub-profiles share the governance trio but diverge on specialists,
which is the whole point of refining the coarse profile:

- **`fe-rootmfe`** carries `@architect` + `@mfe` because the shell owns routing
  and wiring child MFEs into the module-federation contract — but not
  `@codegen`/`@state` (shells wire, they don't author feature code or stores).
- **`fe-childmfe`** is the feature workhorse: `@codegen` + `@state` for feature
  code and Zustand stores, with `move-to-shared` available so anything reused
  migrates to `eq-one-shared` (dedup-policy).
- **`fe-shared`** is anchored by `@shared-curator` (the "no repeat code" enforcer)
  and drops the screen-level agents `@mfe`/`@design-system`/`@contract`/`@a11y`.
- **`fe-designsystem`** is the leanest: `@design-system` + `@a11y` for
  component quality, no shell/store/boundary agents.

And **`be-experienceapi`** is the only profile carrying `@security` (opus) on the
BFF boundary plus the full BFF specialist set (`@domain-folder`, `@bff-shaper`,
`@downstream-connector`, `@contract-publisher`) and the boundary test pair
(`@contract-tester`, `@integration-tester`).
