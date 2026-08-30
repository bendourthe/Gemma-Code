"""v1.14.0 Phase 2 -- Hugging Face auth discovery and validation.

Gated open-weight models (sana-1.6b-int4) are
open but sit behind a Hugging Face license click-through, so downloading them
needs a token from an account that accepted the license. This module resolves
that token automatically from every place a user might already have one, so
the common case needs zero user action; the guided installer step
(``widgets.gated_auth_dialog``) is the last resort when nothing is found.

Discovery precedence (first hit wins):

1. ``InstallerState.hf_token`` -- a token the guided step captured this run,
   or one an operator injected programmatically.
2. Environment -- ``HF_TOKEN`` then ``HUGGING_FACE_HUB_TOKEN``.
3. The Hugging Face CLI cache -- the token written by ``huggingface-cli login``
   / ``hf auth login`` at ``$HF_TOKEN_PATH`` or ``$HF_HOME/token`` or
   ``~/.cache/huggingface/token``.

A token is only ever sent as an ``Authorization: Bearer`` header and is never
written to the log; ``mask_token`` produces a safe form for UI confirmation.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path

import httpx

from nexus_installer.installer_state import InstallerState

LoginFn = Callable[..., object]
GetTokenFn = Callable[[], object]
ValidateFn = Callable[[str, str], bool]
HttpGetFn = Callable[..., object]

# Environment variables Hugging Face tooling reads, in precedence order.
HF_TOKEN_ENV_VARS = ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN")

# Model-info API used to validate that a token actually has access to a
# (possibly gated) repo: 200 = reachable with these credentials.
HF_MODEL_INFO_URL = "https://huggingface.co/api/models/{repo}"


def browser_login_for_repo(
    repo: str,
    *,
    login: LoginFn | None = None,
    get_token: GetTokenFn | None = None,
    validate: ValidateFn | None = None,
) -> str | None:
    """Run Hugging Face browser device login and return a repo-valid token.

    The library owns the OAuth device-code exchange and persists/refeshes the
    token in its standard cache. The model publisher's gated-access form still
    must be accepted by the user in a browser before validation can succeed.
    Injectable callables keep the network/browser flow out of unit tests.
    """
    if not repo:
        return None
    if login is None or get_token is None:
        from huggingface_hub import get_token as hf_get_token
        from huggingface_hub import login as hf_login

        login = login or hf_login
        get_token = get_token or hf_get_token
    login(skip_if_logged_in=False)
    token = get_token()
    if not isinstance(token, str) or not token.strip():
        return None
    validator = validate or validate_token_for_repo
    return token.strip() if validator(repo, token.strip()) else None


def hf_token_from_env() -> str | None:
    """Return a Hugging Face token from the environment, if set.

    Checked in order: ``HF_TOKEN`` then ``HUGGING_FACE_HUB_TOKEN``. The token
    is sent only as an ``Authorization`` header and is never written to the log.
    """
    for name in HF_TOKEN_ENV_VARS:
        value = os.environ.get(name)
        if value and value.strip():
            return value.strip()
    return None


def hf_cache_token_path() -> Path:
    """Path of the Hugging Face CLI cached token.

    Honors ``HF_TOKEN_PATH`` (explicit file), then ``HF_HOME`` (its ``token``
    child), then the default ``~/.cache/huggingface/token``.
    """
    explicit = os.environ.get("HF_TOKEN_PATH")
    if explicit and explicit.strip():
        return Path(explicit).expanduser()
    hf_home = os.environ.get("HF_HOME")
    if hf_home and hf_home.strip():
        return Path(hf_home).expanduser() / "token"
    return Path.home() / ".cache" / "huggingface" / "token"


def hf_token_from_cache() -> str | None:
    """Return the token written by ``huggingface-cli login``, if present."""
    path = hf_cache_token_path()
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value or None


def discover_hf_token(state: InstallerState | None = None) -> str | None:
    """Resolve a Hugging Face token from state, environment, or the HF cache.

    Returns the first token found in precedence order, or ``None`` when the
    user has no token anywhere (the signal to fall back to the guided step).
    """
    if state is not None:
        token = getattr(state, "hf_token", "")
        if isinstance(token, str) and token.strip():
            return token.strip()
    env = hf_token_from_env()
    if env:
        return env
    return hf_token_from_cache()


def mask_token(token: str | None) -> str:
    """A log/UI-safe rendering of a token (never the full secret)."""
    if not token:
        return "(none)"
    token = token.strip()
    if len(token) <= 8:
        return "***"
    return f"{token[:3]}...{token[-2:]}"


def validate_token_for_repo(
    repo: str,
    token: str,
    get: HttpGetFn | None = None,
) -> bool:
    """True when ``token`` can reach ``repo`` (accepted license + valid token).

    Queries the Hugging Face model-info API with the token; HTTP 200 means the
    credentials have access. ``get`` is injectable for tests.
    """
    if not repo or not token or not token.strip():
        return False
    caller = get or (lambda url, **kw: httpx.get(url, **kw))
    url = HF_MODEL_INFO_URL.format(repo=repo)
    headers = {"Authorization": f"Bearer {token.strip()}"}
    try:
        resp = caller(url, headers=headers, follow_redirects=True, timeout=15)
    except httpx.HTTPError:
        return False
    return getattr(resp, "status_code", 0) == 200
