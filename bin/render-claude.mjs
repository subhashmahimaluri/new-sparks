#!/usr/bin/env node
// bin/render-claude.mjs — render the canonical source into Claude Code's .claude/ tree.
// .claude/ is GENERATED. Edit the canonical source (agents/, skills/, orchestrators/) and re-run.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderClaude } from './render-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const n = renderClaude(ROOT, ROOT);
console.log(`eq-sparks → Claude Code: ${n.agents} agents → .claude/agents, ${n.skills} skills → .claude/skills, ${n.commands} orchestrators → .claude/commands`);
