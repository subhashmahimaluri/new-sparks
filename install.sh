#!/usr/bin/env sh
# install.sh — POSIX bootstrap for eq-sparks.
#   sh install.sh --profile=fe-childmfe [--ide=claude,copilot] [--offline-only]
# Renders the harness into the current repo. Requires Node 18+ (no other deps).
set -e

if ! command -v node >/dev/null 2>&1; then
  echo "eq-sparks: Node 18+ is required but was not found on PATH." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "eq-sparks: Node 18+ required (found $(node -v))." >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/cli/eq-sparks.mjs" init "$@"
