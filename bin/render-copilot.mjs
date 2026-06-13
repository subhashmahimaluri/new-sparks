#!/usr/bin/env node
// bin/render-copilot.mjs — render the canonical source into GitHub Copilot's .github/ tree.
//   orchestrators → .github/agents/<id>.agent.md            (ROOT — the selectable custom agents)
//   sub-agents    → .github/agents/<category>/<id>.agent.md (delegation-only, user-invocable: false)
//   skills        → .github/skills/<id>/SKILL.md
//   guardrails + principles → .github/instructions/<id>.instructions.md  (applyTo: "**")
//   + .github/copilot-instructions.md (repo-wide index) + .vscode/settings.json (chat.agentFilesLocations)
// The hidden agentic OS stays in .eq-sparks/ — never rendered here. .github/ is GENERATED.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCopilot } from './render-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const n = renderCopilot(ROOT, ROOT);
console.log(`eq-sparks → Copilot: ${n.orchestrators} orchestrators → .github/agents/*.agent.md, ${n.agents} sub-agents → .github/agents/<category>/, ${n.skills} skills, ${n.instructions} instructions`);
