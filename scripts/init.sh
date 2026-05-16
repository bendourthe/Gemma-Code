#!/usr/bin/env bash
# v0.8.0 Phase 2 (item C2) -- lifecycle bootstrap for Gemma Code.
#
# Five verified steps before any work begins:
#   1. npm ci
#   2. npm run lint
#   3. npm run build
#   4. Required harness files present at repo root
#   5. Required specialist asset files present
#
# Exit 0 only when all five steps pass. Exit 1 with a descriptive error
# otherwise. Idempotent -- safe to re-run.
#
# See scripts/init.ps1 for the Windows equivalent.

set -euo pipefail

log_info()  { printf '[init] %s\n' "$*"; }
log_step()  { printf '[init] ---- %s ----\n' "$*"; }
log_error() { printf '[init] ERROR: %s\n' "$*" >&2; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REQUIRED_FILES=(
  "AGENTS.md"
  "ARCHITECTURE.md"
  "feature_list.json"
  "clean-state-checklist.md"
  "docs/v0.8.0/plans/v0.8.0-cycle.md"
  "docs/v0.8.0/known-gaps.md"
)

REQUIRED_SPECIALISTS=(
  "assets/specialists/research.md"
  "assets/specialists/verification.md"
  "assets/specialists/planning.md"
  "assets/specialists/orchestration.md"
)

# ---------------------------------------------------------------------------
# Step 1: npm ci
# ---------------------------------------------------------------------------
log_step "Step 1/5: npm ci"
if ! command -v npm >/dev/null 2>&1; then
  log_error "npm not found on PATH. Install Node.js 20+ from https://nodejs.org/"
  exit 1
fi
if ! npm ci --silent >/dev/null; then
  log_error "Step 1 (npm ci) failed. Check your network and node version."
  exit 1
fi
log_info "Step 1 OK"

# ---------------------------------------------------------------------------
# Step 2: npm run lint
# ---------------------------------------------------------------------------
log_step "Step 2/5: npm run lint"
if ! npm run --silent lint; then
  log_error "Step 2 (lint) failed. Fix lint errors before continuing."
  exit 1
fi
log_info "Step 2 OK"

# ---------------------------------------------------------------------------
# Step 3: npm run build
# ---------------------------------------------------------------------------
log_step "Step 3/5: npm run build"
if ! npm run --silent build; then
  log_error "Step 3 (build) failed. Fix type errors before continuing."
  exit 1
fi
log_info "Step 3 OK"

# ---------------------------------------------------------------------------
# Step 4: harness files present
# ---------------------------------------------------------------------------
log_step "Step 4/5: harness files"
missing=()
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$REPO_ROOT/$f" ]; then
    missing+=("$f")
  fi
done
if [ ${#missing[@]} -ne 0 ]; then
  log_error "Step 4 failed -- missing harness files:"
  for f in "${missing[@]}"; do
    log_error "  - $f"
  done
  exit 1
fi
log_info "Step 4 OK"

# ---------------------------------------------------------------------------
# Step 5: specialist asset files present
# ---------------------------------------------------------------------------
log_step "Step 5/5: specialist assets"
missing=()
for f in "${REQUIRED_SPECIALISTS[@]}"; do
  if [ ! -f "$REPO_ROOT/$f" ]; then
    missing+=("$f")
  fi
done
if [ ${#missing[@]} -ne 0 ]; then
  log_error "Step 5 failed -- missing specialist asset files:"
  for f in "${missing[@]}"; do
    log_error "  - $f"
  done
  exit 1
fi
log_info "Step 5 OK"

printf '[init] All five steps passed. Ready to work.\n'
