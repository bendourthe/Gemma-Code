"""Verify that all Gemma Code components work after a smoke install.

Emits a JSON report to stdout describing each check's pass/fail state
and details. Exits 0 when every check passes; exits 1 otherwise.

Usage::

    python tests/smoke/verify-components.py \
      --install-path /tmp/gemma-test \
      --ollama-url http://localhost:11434 \
      --expect-model gemma4:e2b \
      --skip-model
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path

try:
    import urllib.request  # stdlib; avoid httpx dep in smoke env
    import urllib.error
except ImportError:  # pragma: no cover
    urllib = None  # type: ignore[assignment]


@dataclass
class Check:
    name: str
    passed: bool
    detail: str = ""


def _run(cmd: list[str], timeout: int = 30) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        return (-1, "", str(exc))
    return (proc.returncode, proc.stdout, proc.stderr)


def check_vscode_extension() -> Check:
    code = shutil.which("code")
    if not code:
        return Check("vscode-extension", False, "`code` CLI not on PATH")
    rc, out, err = _run([code, "--list-extensions"])
    if rc != 0:
        return Check("vscode-extension", False, f"code exit {rc}: {err.strip()}")
    # v1.1.0 rename: the published id is `nexus-coding.nexus-coding`; accept the
    # legacy `gemma-code.gemma-code` for installs that predate the rename.
    present = "nexus-coding.nexus-coding" in out or "gemma-code.gemma-code" in out
    return Check(
        "vscode-extension",
        present,
        "extension listed" if present else "extension missing from listing",
    )


def check_ollama_reachable(ollama_url: str) -> Check:
    url = ollama_url.rstrip("/") + "/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:  # type: ignore[union-attr]
            if resp.status == 200:
                return Check("ollama-reachable", True, f"{url} returned 200")
            return Check("ollama-reachable", False, f"{url} returned {resp.status}")
    except urllib.error.URLError as exc:  # type: ignore[union-attr]
        return Check("ollama-reachable", False, f"{url} unreachable: {exc.reason}")


def check_venv(install_path: str) -> Check:
    venv = Path(install_path) / "venv"
    python_bin = (
        venv / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")
    )
    if not python_bin.is_file():
        return Check("python-venv", False, f"no python at {python_bin}")
    rc, out, err = _run(
        [str(python_bin), "-c", "import fastapi; print(fastapi.__version__)"],
    )
    if rc != 0:
        return Check("python-venv", False, f"fastapi import failed: {err.strip()}")
    return Check("python-venv", True, f"fastapi {out.strip()}")


def check_model_available(ollama_url: str, expected_model: str) -> Check:
    url = ollama_url.rstrip("/") + "/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:  # type: ignore[union-attr]
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return Check("model-available", False, f"api/tags failed: {exc}")
    models = [m.get("name", "") for m in data.get("models", [])]
    present = expected_model in models
    return Check(
        "model-available",
        present,
        f"found {expected_model}" if present else f"missing; have {models[:3]}",
    )


def check_backend_starts(install_path: str, backend_port: int) -> Check:
    venv = Path(install_path) / "venv"
    python_bin = (
        venv / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")
    )
    if not python_bin.is_file():
        return Check("backend-starts", False, f"no python at {python_bin}")
    # Start the backend in a subprocess, poll /health, kill it.
    env = {**os.environ, "GEMMA_BACKEND_PORT": str(backend_port)}
    proc = subprocess.Popen(
        [str(python_bin), "-m", "backend.main"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        url = f"http://localhost:{backend_port}/health"
        deadline = time.monotonic() + 10
        last_error = "timeout"
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(url, timeout=2) as resp:  # type: ignore[union-attr]
                    if resp.status == 200:
                        return Check("backend-starts", True, "/health 200")
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
            time.sleep(0.5)
        return Check("backend-starts", False, f"/health never returned 200: {last_error}")
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            proc.kill()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Gemma Code installation")
    parser.add_argument("--install-path", required=True)
    parser.add_argument("--ollama-url", default="http://localhost:11434")
    parser.add_argument("--backend-port", type=int, default=11435)
    parser.add_argument("--expect-model", default=None)
    parser.add_argument("--skip-model", action="store_true")
    parser.add_argument(
        "--skip-backend",
        action="store_true",
        help="Skip backend start check (useful when venv has no backend module)",
    )
    parser.add_argument(
        "--skip-extension",
        action="store_true",
        help=(
            "Skip the VS Code extension check. Used by the smoke tests, which "
            "run the installer with --skip-extension (no built VSIX in a source "
            "checkout), so the extension is intentionally never installed."
        ),
    )
    args = parser.parse_args()

    checks: list[Check] = []
    if not args.skip_extension:
        checks.append(check_vscode_extension())
    checks.append(check_ollama_reachable(args.ollama_url))
    # The Python venv (and its FastAPI backend) was removed in v0.4.0; the venv
    # check only made sense while the installer provisioned a backend venv. Gate
    # it behind the same --skip-backend flag the smoke tests already pass.
    if not args.skip_backend:
        checks.append(check_venv(args.install_path))
    if args.expect_model and not args.skip_model:
        checks.append(check_model_available(args.ollama_url, args.expect_model))
    if not args.skip_backend:
        checks.append(check_backend_starts(args.install_path, args.backend_port))

    report = {
        "checks": [asdict(c) for c in checks],
        "success": all(c.passed for c in checks),
    }
    print(json.dumps(report, indent=2))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
