"""v1.14.0 Phase 2 -- Hugging Face token discovery, masking, and validation."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from nexus_installer.engine.hf_auth import (
    browser_login_for_repo,
    discover_hf_token,
    hf_cache_token_path,
    hf_token_from_cache,
    hf_token_from_env,
    mask_token,
    validate_token_for_repo,
)
from nexus_installer.installer_state import InstallerState


def test_browser_login_returns_repo_valid_cached_token() -> None:
    opened: list[tuple[str, str]] = []
    token = browser_login_for_repo(
        "org/repo",
        authorize=lambda url, code: opened.append((url, code)),
        request_device_code=lambda: {
            "verification_uri_complete": "https://example.test/device?code=ABCD",
            "user_code": "ABCD",
        },
        poll_device_token=lambda info, **kw: {"access_token": "oauth-token"},
        validate=lambda repo, value: repo == "org/repo" and value == "oauth-token",
    )
    assert token == "oauth-token"
    assert opened == [("https://example.test/device?code=ABCD", "ABCD")]


def test_browser_login_rejects_token_without_repo_access() -> None:
    assert (
        browser_login_for_repo(
            "org/repo",
            authorize=lambda url, code: None,
            request_device_code=lambda: {
                "verification_uri_complete": "https://example.test/device",
                "user_code": "ABCD",
            },
            poll_device_token=lambda info, **kw: {"access_token": "oauth-token"},
            validate=lambda repo, value: False,
        )
        is None
    )


def test_browser_login_uses_verification_uri_fallback() -> None:
    opened: list[tuple[str, str]] = []
    browser_login_for_repo(
        "org/repo",
        authorize=lambda url, code: opened.append((url, code)),
        request_device_code=lambda: {
            "verification_uri": "https://example.test/device",
            "user_code": "WXYZ",
        },
        poll_device_token=lambda info, **kw: {"access_token": "oauth-token"},
        validate=lambda repo, value: True,
    )
    assert opened == [("https://example.test/device", "WXYZ")]


@pytest.fixture(autouse=True)
def _isolate_hf_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Clear HF env + point the cache at an empty dir so tests are hermetic."""
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGING_FACE_HUB_TOKEN", raising=False)
    monkeypatch.delenv("HF_TOKEN_PATH", raising=False)
    monkeypatch.setenv("HF_HOME", str(tmp_path))


class TestEnvToken:
    def test_none_when_unset(self) -> None:
        assert hf_token_from_env() is None

    def test_reads_hf_token_first(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HUGGING_FACE_HUB_TOKEN", "hub")
        monkeypatch.setenv("HF_TOKEN", "  primary  ")
        assert hf_token_from_env() == "primary"

    def test_falls_back_to_hub_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HUGGING_FACE_HUB_TOKEN", "hub")
        assert hf_token_from_env() == "hub"


class TestCacheToken:
    def test_path_honors_hf_home(self, tmp_path: Path) -> None:
        assert hf_cache_token_path() == tmp_path / "token"

    def test_path_honors_explicit_token_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        explicit = tmp_path / "custom_token"
        monkeypatch.setenv("HF_TOKEN_PATH", str(explicit))
        assert hf_cache_token_path() == explicit

    def test_reads_cache_file(self, tmp_path: Path) -> None:
        (tmp_path / "token").write_text("  cached-tok  ", encoding="utf-8")
        assert hf_token_from_cache() == "cached-tok"

    def test_none_when_cache_absent(self) -> None:
        assert hf_token_from_cache() is None


class TestDiscoverPrecedence:
    def test_state_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HF_TOKEN", "env")
        state = InstallerState(hf_token="from-state")
        assert discover_hf_token(state) == "from-state"

    def test_env_over_cache(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        (tmp_path / "token").write_text("cache", encoding="utf-8")
        monkeypatch.setenv("HF_TOKEN", "env")
        assert discover_hf_token(InstallerState()) == "env"

    def test_cache_when_no_state_no_env(self, tmp_path: Path) -> None:
        (tmp_path / "token").write_text("cache", encoding="utf-8")
        assert discover_hf_token(InstallerState()) == "cache"

    def test_none_when_nothing(self) -> None:
        assert discover_hf_token(InstallerState()) is None

    def test_none_without_state(self) -> None:
        assert discover_hf_token(None) is None


class TestMaskToken:
    def test_none(self) -> None:
        assert mask_token(None) == "(none)"
        assert mask_token("") == "(none)"

    def test_short(self) -> None:
        assert mask_token("abcd") == "***"

    def test_long_masks_middle(self) -> None:
        masked = mask_token("hf_abcdefghij")
        assert masked.startswith("hf_") and masked.endswith("ij")
        assert "cdefgh" not in masked


class TestValidateTokenForRepo:
    def test_true_on_200_with_auth_header(self) -> None:
        seen: dict = {}

        def fake_get(url: str, **kw: object) -> object:
            seen["url"] = url
            seen["headers"] = kw.get("headers")
            return SimpleNamespace(status_code=200)

        assert validate_token_for_repo("org/repo", "tok", get=fake_get) is True
        assert seen["headers"]["Authorization"] == "Bearer tok"
        assert "org/repo" in seen["url"]

    def test_false_on_401(self) -> None:
        assert (
            validate_token_for_repo(
                "org/repo", "tok", get=lambda u, **k: SimpleNamespace(status_code=401)
            )
            is False
        )

    def test_false_on_empty_inputs(self) -> None:
        assert validate_token_for_repo("", "tok") is False
        assert validate_token_for_repo("org/repo", "  ") is False

    def test_false_on_http_error(self) -> None:
        def boom(url: str, **kw: object) -> object:
            raise httpx.HTTPError("network down")

        assert validate_token_for_repo("org/repo", "tok", get=boom) is False
