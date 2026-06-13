---
name: figma-context
description: Fetch design context from a Figma URL via the Figma MCP server — frame hierarchy, text, styles, referenced component names, and a render. Called ONLY when the PBI links a Figma file and no [skip-figma] flag is set.
kind: skill
id: figma-context
version: 0.1.0
status: draft
mcp: figma
cacheable: true
---

# figma-context

## Description

Pulls the design source-of-truth for a PBI straight from Figma so frontend agents build against the real frame, not a guess. Given a Figma URL (file or node), it returns the frame hierarchy, all text content, applied styles/tokens, the **referenced component names**, and a render image of the target frame.

This skill is a read-only fetch primitive: it gathers context, it does not generate code. Component names it surfaces are the hook that lets `@design-system` map design components onto real `eq-one-design-system` components (the facade over `eq-one-studio` Storybook) and BLOCK any hand-rolled equivalent. It runs only inside `/scaffold` (and any flow that has a linked design), and only when `ado-context` actually found a Figma URL.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `figma_url` | yes | A Figma file or node URL, normally lifted verbatim from the PBI description by `ado-context`. May include a `node-id`. |
| `depth` | no | Frame-tree traversal depth. Default `2`. Higher = more nodes, more tokens — keep shallow. |
| `node_id` | no | Specific node/frame to target when the URL points at a whole file. |
| `want_render` | no | Default `true`. Set `false` to skip the image and save tokens when only structure/text/components are needed. |

## Outputs

A structured `figma_context` object:

- `frames` — frame/layer hierarchy (names, types, nesting) up to `depth`.
- `text` — all text strings with their layer names (labels, headings, CTA copy, helper/error text).
- `styles` — applied color/typography/spacing styles and any Figma variables (design tokens).
- `component_names[]` — names of referenced Figma components/instances. **The handoff to `@design-system`.**
- `render` — a render image (PNG) of the target frame, when `want_render` is true.
- `source` — `{ figma_url, node_id, depth, fetched_at }` provenance for the run log.

## Tools Needed

- Figma MCP server (`mcp: figma`) — the fetch transport. No other tools. This skill never writes files, never runs Bash, never edits code.

## Constraints

- **cacheable: true (per-run, keyed on `figma_url` + `depth`)** — per the cache-policy, cache the fetched `figma_context` so re-asking for the same URL/depth inside one run is a hit, not a second MCP round-trip. Use `cache-lookup` before fetching. A different `node_id` or `want_render` is a different read; key includes `node_id` when present. NEVER cache across runs — designs move.
- **Auth via browser/OAuth — no token in the repo.** The Figma MCP server holds the session; this skill carries NO secret, env var, or PAT. Honour safety-rails: nothing sensitive is logged or written.
- Read-only. Path-policy: writes nothing to any repo.
- Keep `depth` shallow and prefer a `node_id` over a whole-file URL — token discipline serves budget-policy. The Figma payload is the volatile tail of the prompt-cache prefix, never the stable head.
- Invoke ONLY when a Figma URL is present AND no `[skip-figma]` flag is set on the PBI. No URL or flag set => skip silently.

### fail_modes

- `no_url` — PBI has no Figma URL → skip the skill, return `{ skipped: true, reason: "no figma url" }`. Not an error.
- `skip_flagged` — `[skip-figma]` present → skip, return `{ skipped: true, reason: "skip-figma flag" }`.
- `auth_required` — MCP session not authenticated (no browser/OAuth) → return `{ error: "auth_required" }` and surface to `@supervisor`; do NOT prompt for or invent a token. The run continues design-blind; `@decision` records the gap.
- `unreachable` / `invalid_url` — bad or dead URL, or node not found → return the error, let `@decision` log a defensible "proceed without design" call.
- `partial` — frame fetched but render failed → return structure + text + components with `render: null`; this is still useful, not a hard fail.

## When to invoke

- Inside `/scaffold` when `ado-context` reports a Figma URL on the PBI and `[skip-figma]` is absent.
- Before any frontend build agent (`@mfe`, `@design-system`, `@state`, `@a11y`) needs to know what the screen looks like.
- Do NOT invoke for BFF-only PBIs, for resumes (`/resume` reuses prior context, never re-fetches), or when the flag says skip.

## How it works

1. Guard: confirm a `figma_url` exists and `[skip-figma]` is NOT set. If either guard fails, return the matching `skipped` result and stop.
2. Normalise the URL: extract `node_id` if embedded; resolve effective `depth` (default `2`).
3. `cache-lookup` on key `(figma-context, 0.1.0, hash(figma_url + node_id + depth + want_render))`. The key covers every input that affects the output — a different `want_render` is a different read (matching Constraints), so a `want_render:false` payload is never returned for a `want_render:true` request. On hit, return the cached `figma_context`. Done.
4. On miss, call the Figma MCP server (browser/OAuth session) to fetch the frame tree to `depth`.
5. Collect text strings, applied styles/variables, and the referenced `component_names[]`.
6. If `want_render`, request a render image of the target frame; on render failure, continue with `render: null` (the `partial` mode).
7. Assemble `figma_context` with `source` provenance, write it to the per-run cache, and return.
8. Hand `component_names[]` to `@design-system` for mapping onto `eq-one-design-system`.

## Anti-patterns

- Reading or requesting a Figma token / API key / env secret. Auth is browser/OAuth only.
- Writing the render or any payload into a repo, or otherwise touching the filesystem.
- Re-fetching the same `figma_url`+`depth` within a run instead of taking the cache hit.
- Caching across runs, or treating a stale cross-run design as current.
- Pulling a whole file at high `depth` when a `node_id` would do — burns budget for no signal.
- Hand-rolling UI from the render: this skill only reports `component_names[]`; `@design-system` owns enforcing real components.
- Hard-failing the whole run on `auth_required`/`unreachable` — surface it; let `@decision` make the logged call to proceed design-blind.

## Example

PBI (via `ado-context`) carries `https://www.figma.com/design/AbC123/SAYE-Dashboard?node-id=42-17`.

```text
figma-context { figma_url: ".../node-id=42-17", depth: 2 }
=> frames:          [ "SAYE Dashboard" > "BalanceCard", "ContributionTable", "PrimaryButton" ]
   text:            [ "Total savings", "£12,480.00", "Next contribution", "Continue" ]
   styles:          { color/brand-primary, type/heading-m, space/16 }
   component_names: [ "Card", "Table", "Button" ]   --> @design-system maps to eq-one-design-system
   render:          <png>
   source:          { figma_url, node_id: "42-17", depth: 2, fetched_at }
```

`[skip-figma]` on the PBI, or no URL at all → `{ skipped: true, reason: ... }`, scaffold proceeds without design context.
