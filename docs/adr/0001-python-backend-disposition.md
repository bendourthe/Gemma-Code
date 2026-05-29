# ADR-0001: Dispose of the Python FastAPI backend

- **Status**: Accepted (2026-04-18)
- **Deciders**: Benjamin Dourthe (project owner) + v0.3.0 code review (docs/archive/versions/v0/v0.3.0/review.md, finding #13)

## Context

v0.1.0 through v0.3.0 shipped with an optional Python FastAPI backend under `src/backend/`. The backend was spawned on extension activation (when `gemma-code.useBackend` was `true`, the default), running a `uvicorn` worker that exposed `/chat/stream`, `/models`, and a few health endpoints. The original motivation was to keep prompt formatting, context compaction, and model-specific tokenization close to the Python ML ecosystem while the TypeScript extension handled IO and UX.

The v0.3.0 code review identified this as a P0 restructuring finding (review.md section 3.5, 6a/6b) for four concrete reasons:

1. **No TypeScript consumer reads `baseUrl`.** `BackendManager` spawns the uvicorn process and records the bound port, but every call site in the extension goes straight to the Ollama REST API at `http://localhost:11434`. The backend is an orphan.
2. **Duplicate logic.** Prompt formatting, compaction, and tool-message shaping are reimplemented in Python in `src/backend/src/backend/services/`, diverging from the canonical TypeScript implementations in `src/chat/` and `src/compaction/`.
3. **Attack surface.** The backend listens on a local port with no authentication, no CORS, and `process.env` inheritance on subprocess spawn. Findings #23, #25, #27, #80, #82 in the review all trace back to the backend surface.
4. **Installer complexity.** The PyQt5 installer (Phase 7) has a `VenvInstaller` step that pins Python, creates a venv, and `pip install`s `backend-requirements.txt`. This is the slowest, most error-prone install step across all three platforms and is the leading support issue (Python not on PATH, venv pip failures on Windows, PEP 668 externally-managed-environment blocks on recent Linux distros).

## Decision

Delete the Python FastAPI backend and everything that supported it. The TypeScript extension talks directly to Ollama.

Concretely, this release removes:

- `src/backend/` (entire tree: `BackendManager.ts`, `src/backend/src/backend/**`, `src/backend/tests/**`, `src/backend/pyproject.toml`, `src/backend/uv.lock`)
- The `useBackend`, `backendPort`, and `pythonPath` settings (both in `src/config/settings.ts` and in `package.json` contributes.configuration)
- The `lint-py` and `test-py` CI jobs in `.github/workflows/ci.yml`
- The `integration-py` nightly job in `.github/workflows/nightly.yml`
- The Python coverage gate in `coverage-gate` (kept the TypeScript gate at 80%)
- The installer `VenvInstaller` step — reduced to a no-op that logs "Python backend is no longer bundled"

No TypeScript consumer changes are required beyond the `extension.ts` activate/deactivate wiring, since nothing ever read from the backend.

## Consequences

**Positive**

- Installer runs ~30s faster on every platform (no Python download, no venv creation, no dependency install)
- Attack surface reduced: no local HTTP listener, no orphaned subprocess, no `process.env` inheritance into a spawned binary
- ~2,000 lines of code deleted (Python source + TypeScript BackendManager + CI YAML)
- 3 of the 5 P2 security findings that targeted the backend (#80, #82, and the auth/CORS items in #23) collapse to "N/A" and no longer need remediation in Phase 2
- No more version drift between Python `prompt_builder.py` and TypeScript `PromptBuilder.ts`

**Negative**

- Users with `gemma-code.useBackend: true` in their workspace/user settings will see those settings become orphaned on upgrade. VS Code shows "unknown setting" warnings but does not block the extension. The CHANGELOG v0.4.0 entry calls this out explicitly.
- If a future v0.5.0+ direction requires Python (e.g. local tokenization for a non-Ollama model), the integration will need to be rebuilt from scratch. This decision accepts that cost because no near-term roadmap item requires Python.

**Neutral**

- The PyQt5 installer remains. The installer still creates the install directory, detects GPU, pulls the Ollama model, and writes `settings.json`. Only the venv step is removed.

## Alternatives Considered

1. **Keep the backend and harden it (add auth + CORS per finding #23).** Rejected: maintaining a second runtime surface for zero consumers is pure cost. Hardening does not address the duplicate-logic or installer-complexity drivers.
2. **Keep the backend but feature-flag it off by default.** Rejected: dead code grows stale. A default-off flag where no one has ever tested the on-path degrades to a latent outage.
3. **Port the Python-specific logic (prompt_builder.py, chat_service.py) to TypeScript first, then delete.** Rejected: the TypeScript implementations in `src/chat/PromptBuilder.ts` and `src/chat/ConversationManager.ts` are already the canonical versions. The Python copies were never the source of truth.

## Compliance / Follow-up

- `git grep -l "BackendManager"` under `src/` must return no results after this change.
- Phase 1 sub-task 1.13 in `docs/archive/versions/v0/v0.4.0/implementation-plan.md` is closed by this ADR.
- Phase 2 sub-tasks 2.2, 2.11, 2.13 (P1/P2 backend-specific security items) are marked **N/A** in the Phase 2 Exit Checklist with this ADR as the reason.
