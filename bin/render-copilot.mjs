#!/usr/bin/env node
// bin/render-copilot.mjs — render the canonical source into GitHub Copilot's .github/ tree.
//   orchestrators → .github/chatmodes/<id>.chatmode.md   (entry points)
//   sub-agents    → .github/agents/<category>/<id>.md     (grouped by category)
//   skills        → .github/skills/<id>/SKILL.md
//   guardrails + principles → .github/instructions/<id>.instructions.md
//   + .github/copilot-instructions.md (repo-wide index)
// The hidden agentic OS stays in .eq-sparks/ — never rendered here. .github/ is GENERATED.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCopilot } from './render-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const n = renderCopilot(ROOT, ROOT);
console.log(`eq-sparks → Copilot: ${n.chatmodes} orchestrators → .github/chatmodes, ${n.agents} agents → .github/agents/<category>, ${n.skills} skills → .github/skills, ${n.instructions} instructions → .github/instructions`);
