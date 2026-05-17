"""Pytest configuration: ensure the repo root is on sys.path so the
`runtimes.diffusion.*` package is importable without an install step.
"""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
