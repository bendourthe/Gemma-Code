#!/usr/bin/env bash
# v0.8.0 Phase 6.5 (item C6) -- Architecture linter wrapper.
#
# Runs dependency-cruiser via `npm run deps:check` and exits non-zero on any
# boundary violation. With `--verbose` the script prints which modules
# triggered each violation; otherwise it summarises pass/fail only.
#
# Intended invocation surfaces:
#   - `scripts/init.sh` -- contributors see boundary issues at setup time
#   - CI                -- the `.github/workflows/check-architecture.yml` job
#
# Exit codes:
#   0 -- no violations
#   1 -- one or more violations (output captured)
#   2 -- npm or depcruise not installed
set -euo pipefail

VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --verbose|-v)
      VERBOSE=1
      ;;
    --help|-h)
      printf "usage: %s [--verbose]\n" "$0"
      exit 0
      ;;
    *)
      printf "unknown argument: %s\n" "$arg" >&2
      exit 2
      ;;
  esac
done

if ! command -v npm >/dev/null 2>&1; then
  printf "[ERROR] npm not found on PATH\n" >&2
  exit 2
fi

# Use a temp file so verbose mode can stream the raw output while the summary
# still has access to the full log.
tmp_log="$(mktemp)"
trap 'rm -f "$tmp_log"' EXIT

if npm run --silent deps:check >"$tmp_log" 2>&1; then
  printf "[INFO]  Architecture check passed.\n"
  exit 0
fi

if [[ "$VERBOSE" == "1" ]]; then
  printf "[ERROR] Architecture violations detected:\n" >&2
  cat "$tmp_log" >&2
else
  violation_count="$(grep -cE "(error|violation)" "$tmp_log" || true)"
  printf "[ERROR] Architecture violations: %s. Re-run with --verbose to inspect.\n" "$violation_count" >&2
fi
exit 1
