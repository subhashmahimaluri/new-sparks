# Figma MCP Integration

> Design-context read for eq-sparks. Lets the platform turn a Figma frame into structured design context — frame hierarchy, text, styles, referenced component names, and a render — so scaffolds match the design without a human re-typing it.

**Server id:** `figma` · **Access:** read-only · **Consumed by:** the `figma-context` skill (`MCP:figma`).

---

## What it is

The Figma MCP server exposes a design's structure to the agent layer. The platform never talks to it directly — it goes through the **`figma-context`** skill, which fetches:

- frame hierarchy
- text content
- styles (tokens, spacing, colour)
- referenced component names (the bridge to `@design-system`)
- a render of the frame

Component names matter most: they let **`@design-system`** force UI onto **eq-one-design-system** components instead of hand-rolling equivalents.

## Auth — NO token committed

- Auth is via **browser / OAuth**. On first use the MCP server opens a browser flow; the session lives in the developer's local MCP runtime.
- **No Figma token, key, or secret is committed** anywhere in eq-sparks or the consumer repos. This is a hard rule under **safety-rails** — see also **path-policy** for what may land in `.eq-sparks/`.
- If a flow is needed in CI later, that is an open infra decision, not something to hardcode.

## Wiring — once, in shared MCP config

Wired **exactly once** in the shared `.vscode/mcp.json` under server id **`figma`**. Consumer repos inherit it through the synced `.eq-sparks/` folder; individual agents and skills do **not** declare their own Figma server.

```jsonc
// .vscode/mcp.json (shape only — no secrets)
{
  "servers": {
    "figma": {
      // official Figma MCP endpoint OR internal EQ endpoint — see Open Question
      // auth: browser / OAuth, resolved at runtime — nothing stored here
    }
  }
}
```

## When it runs — conditional, scaffold only

Only **`/scaffold`** calls `figma-context`, and only when **both** hold:

1. the ADO PBI (fetched by **`ado-context`**) links a Figma file URL, **and**
2. the PBI carries no **`[skip-figma]`** flag.

If either condition fails, the orchestrator skips the Figma call entirely — no wasted MCP round-trip, no budget spent. This keeps the run inside the ceiling enforced by **budget-policy** / **budget-check**, and means no-design PBIs never block on Figma.

```
PBI has Figma URL?  ──no──►  skip figma-context
        │ yes
        ▼
[skip-figma] flag?  ──yes─►  skip figma-context
        │ no
        ▼
   run figma-context  ──►  design context → @architect / @design-system
```

## Cost notes

- Per the **cache-policy** stable prefix `[platform | agent spec | volatile task]`, the Figma URL and design context belong to the **volatile task** segment.
- Design-context reads are read-only fetches and are eligible for the per-run **cache-lookup** primitive keyed on the resolved input — re-fetching the same frame inside one run is avoided.
- The skill itself is mechanical fetch + shape work; it does not change the **Haiku-first** posture of the agents that consume its output.

---

## OPEN QUESTION — official Figma MCP vs internal endpoint

**Unresolved:** whether server `figma` points at the **official Figma MCP server** or an **internal EQ-hosted endpoint**.

- *Official:* less to run; auth + capabilities follow Figma's published flow; subject to their availability and rate limits.
- *Internal:* fits EQ network/security posture, can proxy auth centrally, but is ours to host and keep current.

Decide before the integration leaves POC. Until resolved, treat the `.vscode/mcp.json` `figma` entry as a placeholder shape (above) and route any ambiguity at scaffold time through **@decision** so the call is logged for human review.
