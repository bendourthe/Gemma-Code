#!/usr/bin/env bash
# Dev setup for the Gemma Code VS Code extension on macOS / Linux.
#
# What this does:
#   1. Verifies Node.js >= 18 (required by VS Code 1.90+).
#   2. Verifies npm is on PATH.
#   3. Verifies (and optionally installs) `ollama` so the extension has a model
#      backend to talk to. Only checks for presence; does not download models.
#   4. Installs npm dependencies.
#   5. Runs the prebuild step that generates `goldenTasksYaml.generated.ts`.
#   6. Runs `tsc` once to confirm the codebase compiles.
#
# Idempotent: re-running is safe.

set -euo pipefail

log_info()  { printf '[dev-setup] %s\n' "$*"; }
log_error() { printf '[dev-setup] ERROR: %s\n' "$*" >&2; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Node + npm
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log_error "node not found. Install Node.js 18+ from https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  log_error "node $NODE_MAJOR detected; 18+ required."
  exit 1
fi
log_info "node $(node --version) OK"

if ! command -v npm >/dev/null 2>&1; then
  log_error "npm not found. It usually ships with Node.js."
  exit 1
fi
log_info "npm $(npm --version) OK"

# ---------------------------------------------------------------------------
# Ollama (required at runtime; not blocked here so contributors can still build)
# ---------------------------------------------------------------------------
if command -v ollama >/dev/null 2>&1; then
  log_info "ollama $(ollama --version 2>/dev/null || echo 'present') OK"
else
  log_info "ollama not found. The extension needs it at runtime."
  log_info "  Install: https://ollama.com/download"
  log_info "  After install, run: ollama pull gemma4"
fi

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
log_info "Installing npm dependencies..."
npm install --no-fund --no-audit --silent

# ---------------------------------------------------------------------------
# Generate + build
# ---------------------------------------------------------------------------
log_info "Running prebuild..."
npm run generate:golden-tasks --silent

log_info "Compiling TypeScript..."
npm run build --silent

log_info "Setup complete. Next steps:"
log_info "  npm run dev     # tsc --watch"
log_info "  npm test        # run unit + integration tests"
log_info "  F5 in VS Code   # launch Extension Development Host"
