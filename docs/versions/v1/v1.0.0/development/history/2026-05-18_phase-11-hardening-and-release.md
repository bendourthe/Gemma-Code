# Phase 11 -- Hardening + security audit + release gate (2026-05-18)

**Plan reference**: [phase-11-hardening-and-release.md](../../plans/phase-11-hardening-and-release.md).
**Goal**: Deep review, security audit, pen-test, code signing, distribution channels, version bump, CHANGELOG, release notes, RTM smoke, known-gaps finalize. Close the v1.0.0 cycle.
**Outcome**: cycle closed. v1.0.0 ready to release subject to operator actions OA-01 (EV signing) and OA-04 (RTM smoke).

---

## 1. Subtasks delivered

| Sub-task | Deliverable | Status |
|---|---|---|
| 11.1 Deep review | `docs/versions/v1/v1.0.0/review/synthesis.md` | green |
| 11.2 Security audit | `docs/versions/v1/v1.0.0/review/security-audit.md` -- zero P0 / P1 | green |
| 11.2 Pen-test (depth=deep) | `docs/versions/v1/v1.0.0/review/penetration-test.md` -- zero P0 / P1 | green |
| 11.3 Authenticode signing | `docs/versions/v1/v1.0.0/release-signing.md` (Section 1 Windows, Section 2 macOS) | docs ready; OA-01 pending |
| 11.4 CHANGELOG | `CHANGELOG.md` v1.0.0 entry with full Added / Changed / Deprecated / Removed / Fixed / Security sections | green |
| 11.4 Release notes | `docs/versions/v1/v1.0.0/release-notes.md` user-facing announcement | green |
| 11.5 Version bump | 6 version-carrying files updated to `1.0.0`; NSIS already at `1.0.0` | green |
| 11.6 RTM smoke | `docs/versions/v1/v1.0.0/rtm-smoke.md` procedure | docs ready; OA-04 pending |
| 11.7 Distribution channels | `docs/versions/v1/v1.0.0/distribution.md` (GitHub Releases + VS Code Marketplace + landing page) | green |
| 11.8 Finalize known-gaps | `docs/versions/v1/v1.0.0/known-gaps.md` flipped to `finalized`; v0.9.0 also flipped | green |
| 11.9 Final stabilization | Test suite at documented baseline (4 pre-existing failures per 2.P3.L); 100 / 100 Python tests; desktop 362 / 362; root build clean | green |

---

## 2. Files written / updated

### New documents

- `docs/versions/v1/v1.0.0/release-notes.md` -- user-facing release announcement.
- `docs/versions/v1/v1.0.0/release-signing.md` -- Authenticode (Windows) + notarization (macOS) workflow.
- `docs/versions/v1/v1.0.0/rtm-smoke.md` -- RTM smoke checklist (12 steps + recording template).
- `docs/versions/v1/v1.0.0/distribution.md` -- distribution channel runbook.
- `docs/versions/v1/v1.0.0/operator-actions.md` -- consolidated operator checklist OA-01 through OA-12.
- `docs/versions/v1/v1.0.0/review/synthesis.md` -- deep-review synthesis.
- `docs/versions/v1/v1.0.0/review/security-audit.md` -- defensive sweep.
- `docs/versions/v1/v1.0.0/review/penetration-test.md` -- 6-specialist OWASP WSTG offensive pass.
- `docs/versions/v1/v1.0.0/development/history/2026-05-18_phase-11-hardening-and-release.md` -- this file.

### Updated documents

- `CHANGELOG.md` -- v1.0.0 entry inserted above the existing `0.30.1` entry, covering every Phase 1-10 deliverable + Phase 11 hardening surface.
- `docs/versions/v1/v1.0.0/known-gaps.md` -- Status flipped to `finalized at v1.0.0 release (Phase 11.8, 2026-05-18)`. Added: 6 new Phase 11 entries (11.P1.LLL, 11.P1.MMM, 11.P2.NNN, 11.P2.OOO, 11.P2.PPP, 11.P1.QQQ). Resolved table extended with 3 v0.9.0 closures (10.N.A, 10.N.Q, 10.N.R, 10.N.T already noted; 10.N.T added explicitly) + 11.P0.RRR + 11.P0.SSS + 11.P1.QQQ. Summary table recomputed. New `## 4. Phase 11 carryforward map` triages every open item to operator-actions.md (15 items), v1.1.0 (47 items), or specific future cycles (4 items).
- `docs/archive/versions/v0/v0.9.0/known-gaps.md` -- Status flipped to `finalized at v1.0.0 release (Phase 11.8, 2026-05-18)`. Closure note references the four items closed in the v1.0.0 cycle and points to `docs/versions/v1/v1.0.0/known-gaps.md` Section 2 for full disposition of remaining open items.

### Version-carrying files (all bumped to `1.0.0`)

- `package.json` (`0.30.1` -> `1.0.0`).
- `desktop/package.json` (`1.0.0-alpha.0` -> `1.0.0`).
- `desktop/src-tauri/Cargo.toml` (`1.0.0-alpha.0` -> `1.0.0`).
- `desktop/src-tauri/tauri.conf.json` (`1.0.0-alpha.0` -> `1.0.0`).
- `scripts/installer/pyqt/pyproject.toml` (`1.0.0a0` -> `1.0.0`).
- `scripts/installer/pyqt/src/nexus_installer/__init__.py` (`0.3.0` -> `1.0.0`; docstring also renamed from "Gemma Code cross-platform installer" to "Nexus cross-platform installer (PyQt5 wizard, formerly Gemma Code)").
- `scripts/installer/build/nsis/nexus-setup.nsi` -- already at `1.0.0` per Phase 9.

---

## 3. Health gates at Phase 11.9 close

| Gate | Threshold | Actual | Status |
|---|---|---|---|
| Vitest (root) | 0 failures beyond 2.P3.L baseline | 4 failures (CRLF/LF snapshot in `SubAgentManager.characterization.test.ts`); 3014 pass; 5 skip | At baseline (better than recorded 5; one workflow-discipline failure resolved earlier) |
| Vitest (desktop) | 0 failures | 362 / 362 pass | green |
| Pytest (Python diffusion) | 0 failures | 100 / 100 pass | green |
| Cargo (Rust) | 0 failures | Validated via `shell-build.yml` matrix on CI; not exercised locally (known-gap 1.P1.A) | green via CI |
| TypeScript build (root) | clean | passes | green |
| ESLint (desktop) | 0 warnings | clean | green |
| `npm audit` | 0 high/critical | 0 | green |

The 4 pre-existing Vitest failures are tracked under known-gap 2.P3.L (CRLF/LF snapshot mismatch on Windows where snapshots are stored with LF but git checks them out with CRLF). A two-line `.gitattributes` rule normalising `tests/snapshots/specialists/*.txt` to LF closes it; that fix lives in the v1.1.0 carryforward bundle.

---

## 4. Cycle-close decision

**Recommendation**: green light v1.0.0 release after operator-action OA-01 (EV signing) and OA-04 (RTM smoke) complete.

No P0 / P1 defects remain in-cycle. Architectural carryforward (47 items, see `docs/versions/v1/v1.0.0/known-gaps.md` Section 4.2) maps cleanly to a single v1.1.0 phase that introduces the shared-core build / `@nexus/core` workspace package. Operator-driven carryforward (15 items, see Section 4.1) maps to `docs/versions/v1/v1.0.0/operator-actions.md`.

---

## 5. Lessons learned

### What went well

- Per-phase known-gaps discipline. Each phase's gaps were recorded with the exact category / severity / reason / suggested-next-step shape, which made the Phase 11.8 triage mechanical instead of an interpretive exercise.
- The carryforward map (Section 4 of the v1.0.0 known-gaps file) consolidates 47 architectural items under one v1.1.0 unlock (the shared-core build). That clarity was hard-won over Phases 3-7 and is exactly the kind of thing the Phase 11 synthesis exists to surface.
- The placeholder-then-real-implementation pattern (in-memory clients, polling-instead-of-channel, stub-executor-then-real-executor) kept every phase's surface working end-to-end without forcing the shared-core build prematurely.

### What we would do differently

- The v1.0.0 cycle is the largest by far (11 phases, 39 sub-phases, ~3000 vitest tests). Splitting into two cycles -- v1.0.0 (Tauri shell + Coding + Chat) and v1.0.0.5 (Image + Video + Installer + Skills) -- would have lowered the cognitive load on any single phase author. The v1.1.0 cycle should pick a tighter scope.
- The shared-core build deferral was correct in hindsight, but it accumulated 47 items behind a single architectural change. Doing the shared-core build in Phase 2 would have eliminated the placeholder pattern -- at the cost of an extra two phases up-front.

---

## 6. v1.1.0 opening notes (for whoever picks it up)

- The first phase of v1.1.0 should be the shared-core build: TypeScript project references between `core/` / `modules/coding/` / `desktop/sidecar/` / `desktop/src/` (or a small workspace-published `@nexus/core` package). This single change closes the 47-item architectural cluster.
- The second phase should be the storage-path call-site rename (2.P1.G) + the `gemma-code.*` settings-key removal + the `gemma-check` CLI removal. These are the last v0.x compat surfaces.
- The third phase opens the audio pillar (the planned fifth module).
- Operator actions OA-01 and OA-04 must complete BEFORE the v1.0.0 tag is pushed; OA-02 (SmartScreen monitoring) starts after release.
