# ADO MCP Integration

> Integration note — **not** a skill. The skill that consumes this server is
> [`ado-context`](../../../.claude/skills/ado-context/SKILL.md). This file documents how the
> underlying Azure DevOps MCP server is wired, authenticated, and configured. Read it once when
> setting up a consumer workspace; the agents never touch it directly.

---

## What it provides

The **ADO MCP server** gives eq-sparks **read access to Azure DevOps work items**. That is the
whole surface area for this POC: fetch a PBI / work item by id and return its title,
description (rendered to markdown), acceptance criteria, tags, parent epic, attachments, and any
Figma URLs embedded in the description.

It is **read-only by design** — agents inspect work-item context to plan and scaffold; they never
write back to ADO. This keeps the boundary clean and the [`safety-rails`](../../guardrails/safety-rails.md)
blast radius small.

**Consumed by:** the [`ado-context`](../../../.claude/skills/ado-context/SKILL.md) skill, which is the
single entry point for ADO data. Orchestrators (notably [`/scaffold`](../../../.claude/commands/scaffold.md))
reach ADO only through that skill, and [`/resume`](../../../.claude/commands/resume.md) deliberately
does **not** re-fetch — it replays cached ADO context from a prior run.

## Authentication

- Auth is **interactive Azure sign-in** — browser-based SSO at first use, then token cache.
- **No PAT (Personal Access Token) is ever committed.** Do not add a PAT to `mcp.json`, to
  `.eq-sparks.yml`, to `.env`, or to any file in any repo. This is enforced by
  [`safety-rails`](../../guardrails/safety-rails.md) and scanned for by `@scanner`'s
  secret-pattern checks.
- Because sign-in is interactive, the developer's own Azure AD identity scopes what the server can
  read — no shared service credential, no over-broad grant.

## Wiring (once per workspace)

The server is wired **exactly once**, in the multi-root workspace file `.vscode/mcp.json`, under the
server id **`ado`**. Consumer repos inherit it through the synced workspace; individual MFE/BFF repos
do **not** declare their own ADO server.

```jsonc
// .vscode/mcp.json  (multi-root workspace — declared once)
{
  "servers": {
    "ado": {
      // URL resolved at render time — see Open Question below
      "url": "<ado-mcp-endpoint>"
    }
  }
}
```

> The literal server id `ado` is load-bearing: the [`ado-context`](../../../.claude/skills/ado-context/SKILL.md)
> skill frontmatter targets `MCP:ado`. Renaming the server breaks the skill.

## Org / project configuration

The ADO **organization** and **project** are **not** hard-coded in `mcp.json`. They come from the
consumer repo's `.eq-sparks.yml` at **render time**:

```yaml
# .eq-sparks.yml
integrations:
  ado:
    organization: <eq-azure-devops-org>
    project: <eq-project>
```

At render the values are interpolated into the server config / skill input, so the same wiring
serves every consumer repo without edits. Keep org/project here, not in committed JSON, so a repo
that points at a different project only changes one declarative file.

---

## OPEN QUESTION — endpoint choice

**Which ADO MCP server backs the `ado` id?**

1. **Official Microsoft ADO MCP server** — vendor-maintained, standard work-item surface, lowest
   maintenance, but tied to Microsoft's hosting/versioning cadence.
2. **Internal EQ-hosted MCP endpoint** — sits inside EQ's network/identity boundary, can pre-shape
   responses and enforce EQ-specific policy, but is ours to build and run.

This choice changes the **`url` value in `.vscode/mcp.json`** (and possibly the auth handshake
details). It does **not** change the `ado` server id, the read-only contract, or the
`.eq-sparks.yml` org/project layout — so the [`ado-context`](../../../.claude/skills/ado-context/SKILL.md)
skill and every orchestrator stay stable whichever way we land. **Decision needed before the first
production render**; until then, point at the official Microsoft server for the POC.
