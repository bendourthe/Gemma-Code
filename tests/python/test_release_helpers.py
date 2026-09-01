from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def load_script(name: str):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_unicode_validator_rejects_and_fixes_bom_and_punctuation(tmp_path: Path) -> None:
    module = load_script("validate_unicode_safety")
    target = tmp_path / "unsafe.md"
    target.write_bytes("\ufeffA \u201cquote\u201d\u2014done\u2026".encode("utf-8"))

    failures, messages = module.validate([target], fix=False)
    assert failures == 1
    assert "U+2014" in messages[0]

    failures, messages = module.validate([target], fix=True)
    assert failures == 0
    assert messages[0].startswith("FIXED")
    assert target.read_bytes() == b'A "quote"-done...'


def test_unicode_path_selection_is_recursive_and_text_only(tmp_path: Path) -> None:
    module = load_script("validate_unicode_safety")
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "a.md").write_text("safe", encoding="utf-8")
    (nested / "binary.bin").write_bytes(b"\xff")
    assert module.selected_paths(tmp_path, [Path("nested")]) == [(nested / "a.md").resolve()]


def test_branch_report_is_read_only_and_structured(tmp_path: Path) -> None:
    module = load_script("check_release_preconditions")
    calls: list[tuple[str, ...]] = []

    def fake_git(_repo: Path, *args: str):
        calls.append(args)
        values = {
            ("branch", "--show-current"): "feat/example",
            ("rev-parse", "--short=12", "HEAD"): "abc123",
            ("status", "--porcelain"): "",
            ("remote", "get-url", "origin"): "https://github.com/example/repo.git",
            ("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"): "origin/feat/example",
            ("for-each-ref", "--format=%(refname:short)", "refs/heads"): "develop\nfeat/example",
            ("branch", "--format=%(refname:short)", "--merged", "HEAD"): "feat/example",
        }
        return module.CommandResult(0, values[args], "")

    module.git = fake_git
    lines = module.report_branches(tmp_path)
    assert "current=feat/example" in lines
    assert "working_tree=clean" in lines
    assert "protected_checkout=no" in lines
    assert all("delete" not in call and "reset" not in call for call in calls)


def test_repo_settings_degrades_when_github_cli_is_unavailable(tmp_path: Path) -> None:
    module = load_script("check_release_preconditions")
    module._repository_slug = lambda _repo: "example/repo"
    module.run_command = lambda _args, _cwd: module.CommandResult(1, "", "not authenticated")
    assert module.report_repo_settings(tmp_path) == [
        "[repo-settings]",
        "status=unavailable",
        "repository=example/repo",
        "reason=not authenticated",
    ]
