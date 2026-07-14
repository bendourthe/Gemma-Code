#!/usr/bin/env bash
# v1.11.0 Phase 2 (T203) -- one-command clean-Linux install-path test.
#
# Builds the no-deps container, runs the installer's headless engine against
# the docker-linux profile (repo mounted read-only, output writable), prints
# the result summary, and exits with the smoke's status.
set -euo pipefail

TESTING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TESTING_DIR/../../.." && pwd)"
PROFILE="${1:-docker-linux}"
OUT_DIR="$(mktemp -d -t nexus-docker-smoke-XXXXXX)"

log_info()  { echo "[INFO]  $*" >&2; }
log_error() { echo "[ERROR] $*" >&2; }

command -v docker >/dev/null 2>&1 || { log_error "docker not found on PATH"; exit 2; }
[ -f "$TESTING_DIR/profiles/$PROFILE.json" ] || {
    log_error "unknown profile '$PROFILE' (expected testing/profiles/$PROFILE.json)"
    exit 2
}

log_info "building the clean-Linux harness image..."
docker build -q -t nexus-installer-smoke "$TESTING_DIR/docker" >/dev/null

log_info "running headless smoke (profile: $PROFILE, output: $OUT_DIR)..."
set +e
docker run --rm \
    -v "$REPO_ROOT:/repo:ro" \
    -v "$OUT_DIR:/out" \
    nexus-installer-smoke \
    --headless-smoke "/repo/scripts/installer/testing/profiles/$PROFILE.json" \
    --smoke-output /out/result.json
run_exit=$?
set -e

if [ ! -f "$OUT_DIR/result.json" ]; then
    log_error "no result.json produced (engine died before writing; exit $run_exit)"
    exit 3
fi

echo ""
echo "=== docker smoke result ==="
python3 - "$OUT_DIR/result.json" << 'PYEOF'
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"schema:        {r.get('schema')}")
print(f"profile:       {r.get('profile')}")
print(f"success:       {r.get('success')}")
print(f"steps done:    {', '.join(r.get('steps_done', []))}")
print(f"steps failed:  {', '.join(r.get('steps_failed', []))}")
PYEOF
echo "full logs:     $OUT_DIR"

if [ "$run_exit" -eq 0 ]; then
    log_info "PASS"
else
    log_error "FAIL (exit $run_exit)"
fi
exit "$run_exit"
