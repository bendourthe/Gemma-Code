#!/usr/bin/env python3
"""Validate UTF-8 text files and optionally normalize unsafe punctuation."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from typing import Iterable, Sequence


UNSAFE_REPLACEMENTS = {
    "\u2013": "-",
    "\u2014": "-",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2026": "...",
    "\u00a0": " ",
}
TEXT_SUFFIXES = {
    ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
    ".ps1", ".py", ".rs", ".sh", ".toml", ".ts", ".tsx", ".txt",
    ".yaml", ".yml",
}


def changed_paths(root: Path) -> list[Path]:
    completed = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        return []
    return [root / line for line in completed.stdout.splitlines() if line.strip()]


def selected_paths(root: Path, requested: Sequence[Path]) -> list[Path]:
    candidates = [root / path for path in requested] if requested else changed_paths(root)
    unique: dict[Path, None] = {}
    for candidate in candidates:
        path = candidate.resolve()
        if path.is_dir():
            for child in path.rglob("*"):
                if child.is_file() and child.suffix.lower() in TEXT_SUFFIXES:
                    unique[child] = None
        elif path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
            unique[path] = None
    return sorted(unique, key=lambda item: item.as_posix().casefold())


def normalize(text: str) -> str:
    for unsafe, replacement in UNSAFE_REPLACEMENTS.items():
        text = text.replace(unsafe, replacement)
    return text


def validate(paths: Iterable[Path], *, fix: bool) -> tuple[int, list[str]]:
    failures = 0
    messages: list[str] = []
    for path in paths:
        raw = path.read_bytes()
        has_bom = raw.startswith(b"\xef\xbb\xbf")
        try:
            text = raw.decode("utf-8-sig" if has_bom else "utf-8")
        except UnicodeDecodeError as exc:
            failures += 1
            messages.append(f"FAIL {path}: invalid UTF-8 at byte {exc.start}")
            continue

        unsafe = sorted({character for character in text if character in UNSAFE_REPLACEMENTS})
        if fix and (has_bom or unsafe):
            path.write_text(normalize(text), encoding="utf-8", newline="")
            messages.append(f"FIXED {path}: bom={has_bom} unsafe={len(unsafe)}")
            continue
        if has_bom or unsafe:
            failures += 1
            codepoints = ",".join(f"U+{ord(character):04X}" for character in unsafe) or "none"
            messages.append(f"FAIL {path}: bom={has_bom} unsafe={codepoints}")
        else:
            messages.append(f"PASS {path}")
    return failures, messages


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="Repository root")
    parser.add_argument("--path", type=Path, action="append", default=[], help="File or directory to validate")
    parser.add_argument("--fix", action="store_true", help="Normalize BOMs and unsafe punctuation in selected paths")
    parser.add_argument("--strict", action="store_true", help="Fail when no eligible paths are selected")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    root = args.root.resolve()
    paths = selected_paths(root, args.path)
    if not paths:
        print("FAIL no eligible text paths selected" if args.strict else "PASS no eligible text paths selected")
        return 1 if args.strict else 0
    failures, messages = validate(paths, fix=args.fix)
    print("\n".join(messages))
    print(f"SUMMARY files={len(paths)} failures={failures} fixed={'yes' if args.fix else 'no'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
