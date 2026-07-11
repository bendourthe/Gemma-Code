#!/usr/bin/env bash
# v0.8.0 Phase 2 (item C2) -- lifecycle bootstrap for Gemma Code.
#
# Six verified steps before any work begins (v0.8.0 Phase 6.5 adds Step 6):
#   1. npm ci
#   2. npm run lint
#   3. npm run build
#   4. Required harness files present at repo root
#   5. Required specialist asset files present
#   6. Architecture boundaries clean (dependency-cruiser)
#
# Exit 0 only when all six steps pass. Exit 1 with a descriptive error
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
  "docs/archive/v0/v0.8/plans/v0.8.0-cycle.md"
  "docs/archive/v0/v0.8/known-gaps.md"
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
log_step "Step 1/6: npm ci"
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
log_step "Step 2/6: npm run lint"
if ! npm run --silent lint; then
  log_error "Step 2 (lint) failed. Fix lint errors before continuing."
  exit 1
fi
log_info "Step 2 OK"

# ---------------------------------------------------------------------------
# Step 3: npm run build
# ---------------------------------------------------------------------------
log_step "Step 3/6: npm run build"
if ! npm run --silent build; then
  log_error "Step 3 (build) failed. Fix type errors before continuing."
  exit 1
fi
log_info "Step 3 OK"

# ---------------------------------------------------------------------------
# Step 4: harness files present
# ---------------------------------------------------------------------------
log_step "Step 4/6: harness files"
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
log_step "Step 5/6: specialist assets"
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

# ---------------------------------------------------------------------------
# Step 6: architecture boundaries (v0.8.0 Phase 6.5)
# ---------------------------------------------------------------------------
log_step "Step 6/6: architecture boundaries"
if ! bash "$REPO_ROOT/scripts/check-architecture.sh"; then
  log_error "Step 6 (architecture) failed. Re-run \`bash scripts/check-architecture.sh --verbose\` to inspect."
  exit 1
fi
log_info "Step 6 OK"

printf '[init] All six steps passed. Ready to work.\n'
