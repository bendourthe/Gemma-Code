"""Cross-platform cleanup after a smoke test run.

Removes the VS Code extension, the install-path directory (venv + anything
else written into it), and optionally stops a local Ollama process that the
smoke test started.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def _run(cmd: list[str]) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return (-1, str(exc))
    return (proc.returncode, proc.stdout + proc.stderr)


# v1.1.0 rename: the published extension id is `nexus-coding.nexus-coding`.
# Keep the legacy `gemma-code.gemma-code` so a pre-rename install is also
# cleaned up. A "not installed" exit is expected (and harmless) for whichever
# id is absent; cleanup never fails the smoke run.
EXTENSION_IDS = ("nexus-coding.nexus-coding", "gemma-code.gemma-code")


def uninstall_extension() -> list[str]:
    code = shutil.which("code")
    if not code:
        return ["code CLI not on PATH; skipping extension uninstall"]
    messages: list[str] = []
    for ext_id in EXTENSION_IDS:
        rc, out = _run([code, "--uninstall-extension", ext_id])
        messages.append(f"uninstall {ext_id} exit={rc}: {out.strip()[:120]}")
    return messages


def remove_install_path(install_path: str) -> list[str]:
    p = Path(install_path)
    if not p.is_dir():
        return [f"install path {p} does not exist (nothing to remove)"]
    try:
        shutil.rmtree(p)
    except Exception as exc:  # noqa: BLE001
        return [f"failed to remove {p}: {exc}"]
    return [f"removed {p}"]


def stop_ollama() -> list[str]:
    # On Linux/macOS, try pkill; on Windows try taskkill.
    if sys.platform == "win32":
        rc, out = _run(["taskkill", "/IM", "ollama.exe", "/F"])
    else:
        rc, out = _run(["pkill", "-f", "ollama serve"])
    return [f"ollama stop rc={rc}: {out.strip()[:120]}"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test cleanup")
    parser.add_argument("--install-path", required=True)
    parser.add_argument("--stop-ollama", action="store_true")
    parser.add_argument("--keep-extension", action="store_true")
    args = parser.parse_args()

    messages: list[str] = []
    if not args.keep_extension:
        messages.extend(uninstall_extension())
    messages.extend(remove_install_path(args.install_path))
    if args.stop_ollama:
        messages.extend(stop_ollama())

    for m in messages:
        print(m)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
