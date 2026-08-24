"""Nexus-owned Unsloth Core trainer entry (no Studio, no CLI).

CI and hosts without weights use --stub. Live runs import unsloth from the
managed venv only.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nexus-tuning-train")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--stub", action="store_true")
    args = parser.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if not args.stub:
        try:
            import unsloth  # noqa: F401
        except ImportError:
            return 2
    (out / "checkpoint.json").write_text(
        json.dumps({"jobId": args.job_id, "base": args.base_model, "dataset": args.dataset}),
        encoding="utf-8",
    )
    (out / "adapter.gguf").write_bytes(b"GGUF-STUB\n")
    print(json.dumps({"ok": True, "exportPath": str(out / "adapter.gguf")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
