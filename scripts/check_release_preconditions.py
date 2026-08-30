#!/usr/bin/env python3
"""Report release branch and repository-setting preconditions without mutation."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import NamedTuple, Sequence


class CommandResult(NamedTuple):
    returncode: int
    stdout: str
    stderr: str


def run_command(args: Sequence[str], cwd: Path) -> CommandResult:
    completed = subprocess.run(
        list(args),
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return CommandResult(completed.returncode, completed.stdout.strip(), completed.stderr.strip())


def git(repo: Path, *args: str) -> CommandResult:
    return run_command(("git", *args), repo)


def report_branches(repo: Path) -> list[str]:
    branch = git(repo, "branch", "--show-current")
    head = git(repo, "rev-parse", "--short=12", "HEAD")
    status = git(repo, "status", "--porcelain")
    remote = git(repo, "remote", "get-url", "origin")
    upstream = git(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
    local = git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads")
    merged = git(repo, "branch", "--format=%(refname:short)", "--merged", "HEAD")

    current = branch.stdout or "(detached)"
    protected = current in {"main", "master", "develop"}
    upstream_text = upstream.stdout if upstream.returncode == 0 else "(none)"
    return [
        "[branches]",
        f"current={current}",
        f"head={head.stdout or '(unknown)'}",
        f"protected_checkout={'yes' if protected else 'no'}",
        f"working_tree={'dirty' if status.stdout else 'clean'}",
        f"origin={remote.stdout if remote.returncode == 0 else '(unavailable)'}",
        f"upstream={upstream_text}",
        f"local_count={len(local.stdout.splitlines()) if local.stdout else 0}",
        f"merged_into_head_count={len(merged.stdout.splitlines()) if merged.stdout else 0}",
    ]


def _repository_slug(repo: Path) -> str | None:
    remote = git(repo, "remote", "get-url", "origin")
    if remote.returncode != 0 or not remote.stdout:
        return None
    value = remote.stdout.removesuffix(".git").replace("\\", "/")
    if value.startswith("git@github.com:"):
        return value.split(":", 1)[1]
    marker = "github.com/"
    if marker in value:
        return value.split(marker, 1)[1]
    return None


def report_repo_settings(repo: Path) -> list[str]:
    slug = _repository_slug(repo)
    lines = ["[repo-settings]"]
    if not slug:
        return [*lines, "status=unavailable", "reason=origin is not a GitHub repository"]

    metadata = run_command(
        (
            "gh",
            "api",
            f"repos/{slug}",
            "--jq",
            "{default_branch,private,archived,has_issues,delete_branch_on_merge}",
        ),
        repo,
    )
    if metadata.returncode != 0:
        reason = metadata.stderr.splitlines()[-1] if metadata.stderr else "gh api unavailable"
        return [*lines, "status=unavailable", f"repository={slug}", f"reason={reason}"]

    try:
        settings = json.loads(metadata.stdout)
    except json.JSONDecodeError:
        return [*lines, "status=unavailable", f"repository={slug}", "reason=invalid gh api response"]

    default_branch = str(settings.get("default_branch") or "main")
    protection = run_command(
        ("gh", "api", f"repos/{slug}/branches/{default_branch}/protection"), repo
    )
    lines.extend(
        [
            "status=observed",
            f"repository={slug}",
            f"default_branch={default_branch}",
            f"private={str(bool(settings.get('private'))).lower()}",
            f"archived={str(bool(settings.get('archived'))).lower()}",
            f"issues_enabled={str(bool(settings.get('has_issues'))).lower()}",
            f"delete_branch_on_merge={str(bool(settings.get('delete_branch_on_merge'))).lower()}",
            f"default_branch_protection={'observed' if protection.returncode == 0 else 'unavailable'}",
        ]
    )
    if protection.returncode != 0:
        reason = protection.stderr.splitlines()[-1] if protection.stderr else "not accessible"
        lines.append(f"protection_reason={reason}")
    return lines


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="Repository root")
    parser.add_argument("--branches", action="store_true", help="Report local branch hygiene")
    parser.add_argument("--repo-settings", action="store_true", help="Report GitHub repository settings")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    repo = args.root.resolve()
    if not (repo / ".git").exists():
        print(f"ERROR: not a Git repository root: {repo}")
        return 2
    if not args.branches and not args.repo_settings:
        print("ERROR: select --branches and/or --repo-settings")
        return 2

    output: list[str] = []
    if args.branches:
        output.extend(report_branches(repo))
    if args.repo_settings:
        if output:
            output.append("")
        output.extend(report_repo_settings(repo))
    print("\n".join(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
