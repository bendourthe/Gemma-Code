# v1.11.0 Phase 2 (T203) -- clean-Linux install-path harness.
#
# A container with NO preinstalled dependencies (no Ollama, no Nexus dirs)
# that runs the installer's headless engine in source mode. The headless path
# is Qt-free by design (PyQt5 imports are lazy in main.py), so the only
# runtime dependency is httpx.
FROM python:3.12-slim

RUN pip install --no-cache-dir "httpx>=0.27" \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONPATH=/repo/scripts/installer/src
WORKDIR /repo

# The repo is bind-mounted read-only at /repo; results land in /out (rw).
ENTRYPOINT ["python", "-m", "nexus_installer.main"]
