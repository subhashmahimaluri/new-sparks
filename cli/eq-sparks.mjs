#!/usr/bin/env node
// cli/eq-sparks.mjs — the eq-sparks distribution CLI (no dependencies, Node 18+).
//
//   npx github:equiniti-org/eq-sparks init   --profile=fe-childmfe [--ide=claude,copilot] [--offline-only]
//   npx github:equiniti-org/eq-sparks sync   [--profile=...] [--ide=...]
//   npx github:equiniti-org/eq-sparks update [--offline-only] [--profile=...]
//
// SRC  = this package (the canonical eq-sparks source; npx fetches it for you).
// DEST = the consumer repo you run the command in (process.cwd()).
//
// Modes:
//   full (default)  → renders .claude/ and/or .github/ for the profile, AND sets up the hidden
//                     agentic OS in .eq-sparks/ (cache/agent-memory/telemetry dirs), .eq-sparks.yml,
//                     and .vscode/mcp.json. Supports Flow 1 (autonomous) + Flow 3 (resume).
//   --offline-only  → renders .github/ ONLY (+ .vscode/mcp.json). No .eq-sparks/ cache/config, no
//                     sync needed — re-run init/update on demand. For Copilot-Enterprise-only teams.

import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { renderClaude, renderCopilot } from '../bin/render-lib.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); // canonical source
const PROFILES = () => readdirSync(join(PKG_ROOT, 'profiles')).filter((p) => existsSync(join(PKG_ROOT, 'profiles', p, 'profile.yml')));

function parseArgs(argv) {
  const a = { _: [] };
  for (const t of argv) {
    if (t.startsWith('--')) {
      const [k, v] = t.slice(2).split('=');
      a[k] = v === undefined ? true : v;
    } else a._.push(t);
  }
  return a;
}

// Minimal YAML reader: pull the list of bare ids under a top-level `key:` (strips inline comments).
function listUnderKey(yaml, key) {
  const lines = yaml.split('\n');
  const out = [];
  let inBlock = false;
  for (const raw of lines) {
    if (/^[A-Za-z0-9_]+:/.test(raw)) inBlock = raw.startsWith(key + ':');
    else if (inBlock) {
      const m = raw.match(/^\s*-\s*([^\s#]+)/);
      if (m) out.push(m[1].replace(/^\//, '')); // tolerate "/scaffold" → "scaffold"
      else if (raw.trim() && !raw.trim().startsWith('#')) break; // left the block
    }
  }
  return out;
}

function loadProfile(name) {
  const p = join(PKG_ROOT, 'profiles', name, 'profile.yml');
  if (!existsSync(p)) {
    console.error(`Unknown profile "${name}". Available: ${PROFILES().join(', ')}`);
    process.exit(1);
  }
  const yaml = readFileSync(p, 'utf8');
  return {
    agents: listUnderKey(yaml, 'agents'),
    skills: listUnderKey(yaml, 'skills'),
    orchestrators: listUnderKey(yaml, 'orchestrators'),
  };
}

function writeIfAbsent(file, content, label) {
  if (existsSync(file)) { console.log(`  • kept existing ${label}`); return; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`  • wrote ${label}`);
}

function ensureGitignore(dest) {
  const gi = join(dest, '.gitignore');
  const needed = ['.eq-sparks/cache/', '.eq-sparks/agent-memory/', '.eq-sparks/telemetry/', '.eq-sparks.yml'];
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const missing = needed.filter((n) => !existing.includes(n));
  if (missing.length) {
    appendFileSync(gi, (existing && !existing.endsWith('\n') ? '\n' : '') + '\n# eq-sparks runtime (hidden agentic OS)\n' + missing.join('\n') + '\n');
    console.log(`  • appended ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} to .gitignore`);
  }
}

function mcpJson() {
  return JSON.stringify({
    servers: {
      // Auth is interactive (browser/OAuth for Figma, Azure sign-in for ADO) — NO tokens committed.
      ado: { type: 'http', url: '<set in MANUAL-STEPS D1 — official MS ADO MCP or internal EQ endpoint>' },
      figma: { type: 'http', url: '<set in MANUAL-STEPS D1 — official Figma MCP or internal EQ endpoint>' },
    },
  }, null, 2) + '\n';
}

function render(dest, ides, filter, { offline }) {
  const out = [];
  if (!offline && ides.includes('claude')) {
    const n = renderClaude(PKG_ROOT, dest, filter);
    out.push(`.claude (${n.agents} agents, ${n.skills} skills, ${n.commands} commands)`);
  }
  if (ides.includes('copilot')) {
    const n = renderCopilot(PKG_ROOT, dest, filter);
    out.push(`.github (${n.chatmodes} chatmodes, ${n.agents} agents, ${n.skills} skills, ${n.instructions} instructions)`);
  }
  return out;
}

function init(args) {
  const dest = args.target ? args.target : process.cwd();
  const profileName = args.profile || 'fe-childmfe';
  const offline = !!args['offline-only'];
  // offline mode is Copilot-first; default it to copilot unless the user asked otherwise.
  const ides = (args.ide || (offline ? 'copilot' : 'claude,copilot')).split(',').map((s) => s.trim());
  const filter = loadProfile(profileName);

  console.log(`eq-sparks init → profile=${profileName} ide=${ides.join('+')} mode=${offline ? 'offline-only' : 'full'}`);
  const rendered = render(dest, ides, filter, { offline });
  rendered.forEach((r) => console.log(`  • rendered ${r}`));

  // .vscode/mcp.json — one shared config (both modes).
  writeIfAbsent(join(dest, '.vscode/mcp.json'), mcpJson(), '.vscode/mcp.json (ADO + Figma — set URLs per MANUAL-STEPS D1)');

  if (!offline) {
    // Hidden agentic OS — runtime dirs (gitignored).
    for (const d of ['cache', 'agent-memory', 'telemetry']) mkdirSync(join(dest, '.eq-sparks', d), { recursive: true });
    console.log('  • created .eq-sparks/{cache,agent-memory,telemetry} (hidden OS)');
    writeIfAbsent(join(dest, '.eq-sparks.yml'),
      readFileSync(join(PKG_ROOT, '.eq-sparks.yml.example'), 'utf8').replace(/^profile:.*$/m, `profile: ${profileName}`),
      '.eq-sparks.yml (from example — fill ADO org/project, NewRelic toggle)');
    ensureGitignore(dest);
  } else {
    console.log('  • offline-only: skipped .eq-sparks/ cache/config (no Flow 1 autonomous, no Flow 3 resume; no sync needed — re-run init/update on demand)');
  }
  console.log('Done. Next: set the MCP URLs in .vscode/mcp.json (MANUAL-STEPS D1) and sign in via browser.');
}

function syncOrUpdate(args, cmd) {
  const dest = args.target ? args.target : process.cwd();
  const offline = !!args['offline-only'];
  const ides = (args.ide || (offline ? 'copilot' : 'claude,copilot')).split(',').map((s) => s.trim());
  // Resolve the profile: flag → existing .eq-sparks.yml → default.
  let profileName = args.profile;
  if (!profileName && existsSync(join(dest, '.eq-sparks.yml'))) {
    const m = readFileSync(join(dest, '.eq-sparks.yml'), 'utf8').match(/^profile:\s*(\S+)/m);
    profileName = m && m[1];
  }
  profileName = profileName || 'fe-childmfe';
  const filter = loadProfile(profileName);

  console.log(`eq-sparks ${cmd} → profile=${profileName} ide=${ides.join('+')} mode=${offline ? 'offline-only' : 'full'}`);
  render(dest, ides, filter, { offline }).forEach((r) => console.log(`  • re-rendered ${r}`));

  if (cmd === 'sync' && !offline) {
    console.log('  • full sync: review the re-rendered .claude/.github diff and open a PR (the consumer eq-sparks-sync workflow does this automatically on a schedule — see templates/consumer/eq-sparks-sync.yml).');
  } else if (offline) {
    console.log('  • offline-only: re-rendered in place, no network/PR step needed.');
  }
}

export async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  switch (cmd) {
    case 'init': return init(args);
    case 'sync': return syncOrUpdate(args, 'sync');
    case 'update': return syncOrUpdate(args, 'update');
    default:
      console.log([
        'eq-sparks — central agentic harness CLI',
        '',
        'Usage:',
        '  eq-sparks init   --profile=<p> [--ide=claude,copilot] [--offline-only]',
        '  eq-sparks sync   [--profile=<p>] [--ide=...]            # full mode: re-render + PR',
        '  eq-sparks update [--offline-only] [--profile=<p>]       # offline: re-render in place',
        '',
        `Profiles: ${PROFILES().join(', ')}`,
      ].join('\n'));
      if (cmd && cmd !== 'help') process.exitCode = 1;
  }
}

// Auto-run only when invoked directly (not when imported by install.js).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
