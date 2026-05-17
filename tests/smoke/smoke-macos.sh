#!/usr/bin/env bash
# macOS smoke test: install Ollama if missing, run installer headless,
# verify components, clean up.
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_PATH="${INSTALL_PATH:-/tmp/gemma-smoke}"
MODEL="${MODEL:-gemma4:e2b}"
WITH_MODEL="${GEMMA_SMOKE_WITH_MODEL:-0}"
readonly RESULTS_DIR="$REPO_ROOT/tests/smoke/results"
mkdir -p "$RESULTS_DIR"

log_info()  { printf '[INFO]  %s\n' "$*" >&2; }
log_error() { printf '[ERROR] %s\n' "$*" >&2; }

check_prereqs() {
    log_info "Checking prerequisites"
    [[ -d "/Applications/Visual Studio Code.app" ]] || { log_error "VS Code not installed"; exit 1; }
    command -v python3 >/dev/null 2>&1 || { log_error "python3 not on PATH"; exit 1; }
}

ensure_ollama() {
    if ! command -v ollama >/dev/null 2>&1; then
        log_info "installing Ollama via brew"
        brew install ollama
    fi
    log_info "starting Ollama serve"
    ollama serve >/tmp/ollama-smoke.log 2>&1 &
    local deadline=$(( $(date +%s) + 60 ))
    until curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; do
        [[ $(date +%s) -lt $deadline ]] || { log_error "Ollama not ready after 60s"; exit 1; }
        sleep 1
    done
}

run_installer() {
    log_info "running headless installer"
    local extra_args=()
    [[ "$WITH_MODEL" == "1" ]] || extra_args+=(--skip-model)
    pushd "$REPO_ROOT/scripts/installer/pyqt" >/dev/null
    PYTHONPATH=src python3 -m nexus_installer.main \
        --headless \
        --install-path "$INSTALL_PATH" \
        --model "$MODEL" \
        --json-output \
        "${extra_args[@]}" > "$RESULTS_DIR/installer.json"
    local rc=$?
    popd >/dev/null
    return $rc
}

run_verify() {
    log_info "verifying components"
    local extra_args=(--skip-backend)
    [[ "$WITH_MODEL" == "1" ]] || extra_args+=(--skip-model)
    pushd "$REPO_ROOT" >/dev/null
    python3 tests/smoke/verify-components.py \
        --install-path "$INSTALL_PATH" \
        --ollama-url http://localhost:11434 \
        "${extra_args[@]}" > "$RESULTS_DIR/verify.json"
    local rc=$?
    popd >/dev/null
    return $rc
}

cleanup() {
    log_info "cleanup"
    pushd "$REPO_ROOT" >/dev/null
    python3 tests/smoke/cleanup.py --install-path "$INSTALL_PATH" || true
    popd >/dev/null
    pkill -f "ollama serve" 2>/dev/null || true
}

trap cleanup EXIT
check_prereqs
ensure_ollama
run_installer
run_verify
log_info "Smoke test PASSED. Results in $RESULTS_DIR"
