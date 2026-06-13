#!/usr/bin/env node
// install.js — bootstrap entry for eq-sparks.
//   node install.js --profile=fe-childmfe [--ide=claude,copilot] [--offline-only]
// Equivalent to `eq-sparks init <flags>`. Used by install.sh and by `npx github:...`.
import { main } from './cli/eq-sparks.mjs';
main(['init', ...process.argv.slice(2)]);
