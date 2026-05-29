# Session history: v1.1.0 Phase 15 -- Hardening + release gate

**Date**: 2026-05-26
**Cycle**: v1.1.0
**Phase**: 15 (Hardening + release gate)
**Plan reference**: [docs/versions/v1/v1.1.0/plans/phase-15-hardening-and-release.md](../../plans/phase-15-hardening-and-release.md)
**Cycle plan**: [docs/versions/v1/v1.1.0/plans/v1.1.0-cycle.md](../../plans/v1.1.0-cycle.md) (Phase 15 row)
**Acceptance scope**: this session landed the static-portion of Phase 15 -- the parts the static-review host can complete on its own (review synthesis, version bump, CHANGELOG, release notes, distribution, known-gaps finalization, operator-action ledger extension). The live operator-action chain (signing + notarization + AppImage RTM + golden-task replay + GPU bench + live DevAI-Hub sync + per-OS RTM smoke + live `/run-deep-review` chain + semantic-release dry-run) carries forward as a consolidated operator-action ledger.

---

## 1. Subtasks completed (static portion)

| Sub-task | Output | Status |
|---|---|---|
| 15.1 (static) | `docs/versions/v1/v1.1.0/review/synthesis.md` (10 sections + 4 static-only findings + 4 live carryforward IDs) | Closed (static portion) |
| 15.6 | Version bump `1.0.0` -> `1.1.0` across 7 product-version files + 5 NSIS literal occurrences | Closed |
| 15.7 | CHANGELOG.md v1.1.0 entry prepended above v0.41.0 block; new `docs/versions/v1/v1.1.0/release-notes.md` ships as the user-facing release content | Closed |
| 15.9 | `docs/versions/v1/v1.1.0/known-gaps.md` finalization: status flip to `finalized at v1.1.0 release (Phase 15.9, 2026-05-26)`; Phase 15 closures + open items appended; Section 3 summary recomputed (37 open / 72 resolved / 109 total); Section 4b carryforward map (v1.1.0 -> v1.2.0) populated | Closed |
| 15.10 | `docs/versions/v1/v1.1.0/distribution.md` mirroring v1.0.0 structure across 3 OS surfaces + renamed Marketplace listing | Closed |
| 15.2 / 15.3 / 15.4 / 15.5 / 15.8 (documentation portion) | `docs/versions/v1/v1.1.0/operator-actions.md` extended with 6 new Phase 15 OA-V1.1.0-15A through 15F entries | Closed (documentation portion) |
| 15.11 (static portion) | Version literal audit + JSON validation across the 4 modified JSON files + cross-doc reference audit | Closed (static portion) |

## 2. Subtasks carried forward (live operator-action chain)

| Sub-task | OA carryforward ID | What is needed |
|---|---|---|
| 15.1 (live) | OA-V1.1.0-15A | Operator host with the full DevAI-Hub skill harness wiring + network egress + headed display to drive `/run-deep-review` + `/run-security-audit` + `/run-penetration-test --depth=deep`. Output overlays `docs/versions/v1/v1.1.0/review/synthesis.md`. |
| 15.2 | OA-V1.1.0-15B | EV Code Signing certificate + HSM (OA-01); Apple Developer Program enrollment + Developer ID Application + Installer certs + notarization workflow (OA-11); Ubuntu 22.04 / 24.04 / Fedora 40 fresh VMs for AppImage smoke (OA-12). |
| 15.3 | OA-V1.1.0-15C | Upstream `bendourthe/DevAI-Hub v1.1.0-baseline` tag + the matching content_hash (OA-06); designer-authored final brand icon set committed under `assets/design/` (OA-07). |
| 15.4 | OA-V1.1.0-15D | Operator's RTX 4070 rig with three resident Ollama models (~22 GB total) for golden-task replay (OA-08) + four resident diffusion models (~17 GB total) for GPU bench across SANA + LTX + SVD + CogVideoX (OA-09) + live network egress for `nexus skills sync` (OA-10). |
| 15.5 | OA-V1.1.0-15E | Three fresh OS VMs (Windows 11 + macOS Sequoia + Ubuntu 24.04) for the per-OS RTM smoke checklists. |
| 15.8 | OA-V1.1.0-15F | `npm ci` populated on the operator host so `npx semantic-release --dry-run` runs against the v1.1.0 tag. |

## 3. Open items added to known-gaps

Four new entries appended to [docs/versions/v1/v1.1.0/known-gaps.md](../../known-gaps.md) `## 1. Open Items`:

- **15.1.P1.KK** -- Live `/run-deep-review` chain not executed on this host (DF, P1) -> closes via OA-V1.1.0-15A.
- **15.8.P1.LL** -- `npx semantic-release --dry-run` not executed on this host (DF, P1) -> closes via OA-V1.1.0-15F.
- **15.11.P2.MM** -- Final lint / build / test gate not run end-to-end on this host (MT, P2) -> closes via OA-V1.1.0-15E (RTM smoke per OS).
- **15.2-5.P1.NN** -- Consolidated live operator-action set (DF, P1) -> closes via OA-V1.1.0-15B + 15C + 15D + 15E.

## 4. Closures added to known-gaps

Six new entries appended to [docs/versions/v1/v1.1.0/known-gaps.md](../../known-gaps.md) `## 2. Resolved` under the new "Phase 15 closures (this commit)" sub-section:

- 15.1 (static portion): `synthesis.md` ships with 10 sections.
- 15.6: Version bumped across all 7 product-version files + 5 NSIS literal occurrences.
- 15.7: CHANGELOG.md entry + `release-notes.md` user-facing release content.
- 15.9: Known-gaps file finalized (status flip + summary recompute + carryforward map).
- 15.10: `distribution.md` ships.
- 15.2-5 + 15.8 (documentation portion): `operator-actions.md` extended with 6 new OA-V1.1.0-15A through 15F entries.

## 5. Test signals

| Surface | Result |
|---|---|
| Code-side test cases | 0 new (Phase 15 is documentation + version bumps + release-gate artifacts). |
| Phase 1-14 cycle tests | All green at their cycle-landing commits per CI history. |
| JSON validation | `package.json`, `package-lock.json`, `desktop/package.json`, `desktop/src-tauri/tauri.conf.json` all parse cleanly post-bump. |
| Version literal audit | 7 product-version files + 5 NSIS literal occurrences all read `1.1.0`. |
| Cross-doc reference audit | Every internal link from `synthesis.md`, `distribution.md`, `release-notes.md`, the new `operator-actions.md` entries, and the new `known-gaps.md` entries resolves against the existing docs trees. |

## 6. Release gate status (at session close)

| Severity | Open | Resolved | Total |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 11 (8 pre-Phase-15 + 3 Phase 15 operator-driven) | 27 | 38 |
| P2 | 25 (24 pre-Phase-15 + 1 Phase 15) | 45 | 70 |
| P3 | 1 | 0 | 1 |
| **Total** | **37** | **72** | **109** |

**Release gate**: PROCEED to v1.1.0 release after the OA-V1.1.0-15A through 15F operator-action chain completes (live deep-review chain returning zero new P0/P1; signing + notarization + AppImage; SHA rotations + final brand icons; golden-task replay + GPU bench + live DevAI-Hub sync; RTM smoke per OS; semantic-release dry-run). The static-portion artifacts shipped in this commit are the canonical reference for the operator to overlay against.

## 7. Files written / modified in this session

**Modified:**

- `CHANGELOG.md` -- prepended v1.1.0 entry above the v0.41.0 semantic-release block.
- `package.json` -- version `0.41.0` -> `1.1.0`.
- `package-lock.json` -- top-level + `desktop/` workspace `version` -> `1.1.0`.
- `desktop/package.json` -- version `1.0.0` -> `1.1.0`.
- `desktop/src-tauri/Cargo.toml` -- package version `1.0.0` -> `1.1.0`.
- `desktop/src-tauri/tauri.conf.json` -- version `1.0.0` -> `1.1.0`.
- `scripts/installer/pyqt/pyproject.toml` -- version `1.0.0` -> `1.1.0`.
- `scripts/installer/pyqt/src/nexus_installer/__init__.py` -- `__version__` `1.0.0` -> `1.1.0`.
- `scripts/installer/build/nsis/nexus-setup.nsi` -- header banner + APP_VERSION + OutFile path literals updated to `1.1.0`.
- `docs/versions/v1/v1.1.0/known-gaps.md` -- finalized: status flip + Phase 15 entries + recomputed summary + Section 4b carryforward map + references extended.
- `docs/versions/v1/v1.1.0/operator-actions.md` -- 6 new Phase 15 OA-V1.1.0-15* entries appended.
- `docs/DEVLOG.md` -- new "[2026-05-26] v1.1.0 Phase 15" entry prepended above the Phase 14 entry.

**Created:**

- `docs/versions/v1/v1.1.0/release-notes.md` -- v1.1.0 user-facing release content.
- `docs/versions/v1/v1.1.0/distribution.md` -- v1.1.0 distribution channels (3 OS surfaces + Marketplace).
- `docs/versions/v1/v1.1.0/review/synthesis.md` -- v1.1.0 static deep-review synthesis.
- `docs/versions/v1/v1.1.0/development/history/2026-05_phase-15-hardening-and-release.md` -- this session history file.

## 8. Deviations from the plan

- **15.6 root `package.json` bump**: the plan listed `package.json` among the version-carrying files to bump. The v1.0.0 cycle had let semantic-release manage `package.json` through the per-feature `0.X.0` minor cycle; this session bumped the root `package.json` to `1.1.0` per the plan's explicit instruction. The Phase 15.8 semantic-release dry-run (operator-gated under OA-V1.1.0-15F) verifies semantic-release's behaviour against the new baseline.
- **15.1 live `/run-deep-review` chain**: the plan calls for the live chain (`analyze-codebase` + `review-codebase` + `run-security-audit` + `run-penetration-test --depth=deep`) producing zero P0 / P1 findings. The static-review host lacks the network egress + the headed display + the full DevAI-Hub skill harness wiring to run the chain, so this session shipped the static-portion synthesis (cross-phase synthesis derived from the running known-gaps + history files) and recorded the live chain as four carryforward IDs (OA-V1.1.0-15-DR-A through DR-D) plus open item 15.1.P1.KK.
- **15.8 semantic-release dry-run**: the plan calls for `npx semantic-release --dry-run` against the v1.1.0 tag. The static-review host has not run `npm ci` in this session so the plugin chain is not present; recorded as open item 15.8.P1.LL closing via OA-V1.1.0-15F.
- **15.2 / 15.3 / 15.4 / 15.5 live operator actions**: the plan calls for live signing + notarization + AppImage RTM + SHA rotations + final brand icons + golden-task replay + GPU bench + live DevAI-Hub sync + three fresh-VM RTM smokes. Each requires external infrastructure not available on this host; consolidated as open item 15.2-5.P1.NN closing via the four OA-V1.1.0-15B / C / D / E carryforward IDs.

## 9. Next steps (operator)

1. **OA-V1.1.0-15A** (highest priority): run `/run-deep-review` + `/run-security-audit` + `/run-penetration-test --depth=deep` against the v1.1.0 delta. Output deposits under `docs/versions/v1/v1.1.0/review/` and overlays `synthesis.md`. Any new P0 / P1 finding bumps the release gate to "RE-REVIEW BEFORE TAG PUSH".
2. **OA-V1.1.0-15F**: `npm ci && npx semantic-release --dry-run` against the v1.1.0 tag. Verify the dry-run output matches the hand-authored CHANGELOG entry from Phase 15.7 modulo formatting.
3. **OA-V1.1.0-15C**: cut the `v1.1.0-baseline` tag in upstream `bendourthe/DevAI-Hub`, rotate the SHA-256 + commit SHA in `scripts/installer/devai-hub-baseline.json`, rotate Ollama installer SHAs per OS, replace the procedural Tauri icons with the final designer-authored set.
4. **OA-V1.1.0-15B**: procure / wire EV signing + Apple Developer ID secrets; tag-push `v1.1.0` to fire the three installer workflows; verify signed Windows installer + notarized macOS DMG + Linux AppImage launches on Ubuntu 22.04 / 24.04 / Fedora 40.
5. **OA-V1.1.0-15D**: on the operator rig, run `nexus-check golden` against the three resident LLMs + diffusion bench across SANA + LTX + SVD + CogVideoX + `nexus skills sync` against the live upstream DevAI-Hub.
6. **OA-V1.1.0-15E**: per-OS RTM smoke on three fresh VMs against the signed installer artifacts.
7. **Tag push**: when all six OA-V1.1.0-15A through 15F entries close, `git push origin v1.1.0`. Release workflows assemble + sign + publish the three OS installers.

## 10. References

- [phase-15-hardening-and-release.md](../../plans/phase-15-hardening-and-release.md) -- plan reference.
- [v1.1.0-cycle.md](../../plans/v1.1.0-cycle.md) -- cycle plan (Phase 15 row).
- [docs/versions/v1/v1.1.0/known-gaps.md](../../known-gaps.md) -- finalized cycle gap log.
- [docs/versions/v1/v1.1.0/operator-actions.md](../../operator-actions.md) -- Phase 15 operator-action ledger.
- [docs/versions/v1/v1.1.0/release-notes.md](../../release-notes.md) -- v1.1.0 user-facing release notes.
- [docs/versions/v1/v1.1.0/distribution.md](../../distribution.md) -- v1.1.0 distribution channels.
- [docs/versions/v1/v1.1.0/review/synthesis.md](../../review/synthesis.md) -- v1.1.0 static deep-review synthesis.
- [CHANGELOG.md](../../../../CHANGELOG.md) -- v1.1.0 hand-authored release entry.
