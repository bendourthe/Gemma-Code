# Nexus v1.5.0 -- Local Agent Maturity + Nexus-Hub Surface Integration

**Cycle**: v1.5.0 (desktop product version 1.4.0 -> 1.5.0)
**Released**: 2026-06-15
**Plan**: [plans/adoption-ecosystem-2026-06.md](plans/adoption-ecosystem-2026-06.md) (7 phases)
**Source comparison**: [comparison-ecosystem-2026-06.md](comparison-ecosystem-2026-06.md) (8-source 2026-06 ecosystem scan)

> Versioning note: the VS Code extension version, the `vX.Y.Z` git tag, and `CHANGELOG.md` are cut automatically by semantic-release on merge to `main` (conventional commits). This file documents the **desktop product cycle** (v1.5.0).

## Highlights

The 2026-06 ecosystem scan largely validated Nexus's existing local-first, single-GPU, desktop-plus-shared-core direction; the adoption set was small, surgical, and entirely local-only / skill / reverse-engineered (zero new outbound calls, credentials, or third-party processors).

### Local Agent Maturity (Phases 1-6)

- **Gemma 4 12B-IT GGUF quant ladder** in the model catalog + hardware-aware picker (item 32).
- **Local OS-keychain credential vault** (`CredentialVault`) as the MCP `${vault}` secret source -- no plaintext config secrets (item 2).
- **Intelligence-per-watt energy telemetry** (`EnergyEstimator`, tokens-per-watt) on the Local Model Status panel (item 18).
- **DCI search-discipline skill** + **agent presets** authored for the catalog (items 11, 21).
- **Inbound prompt-injection classifier** screening fetched content, warn-then-allow (item 3).
- **Swarm / DAG orchestration**: a bounded planner/critic/worker layer over worktree-isolated sub-agents, opt-in (item 36); closed v1.4.0 deferrals `T018.P3.A/B` + `T016.P3.A`.
- **Desktop / model-layer re-partials**: multimodal image input via the Gemma 4 vision gate (item 33), side-by-side preview pane (item 24), vault-only credential management UI (item 25), cross-surface session resume (item 26).
- **Tree-sitter `.wasm` packaging** closure for the bundled sidecar (v1.4.0 `T022.P3.A`).

### Nexus-Hub surface integration (Phase 7)

Nexus-AI now consumes the Nexus-Hub catalog across six surfaces (previously one): skills, plus `data/skills.json` index enrichment, `catalog/rules` language rules in the prompt, `catalog/agents` personas in the sub-agent layer, `catalog/commands` hub-command routing, `catalog/hooks` pull + installer, and the `mcp-servers.json` registry through a policy-gated, connection-free filter. The two new Phase 2 skills were published to Hub `develop`. See [development/nexus-hub-integration-delta.md](development/nexus-hub-integration-delta.md).

## Quality gate

Root test suite **4080 passed** / 5 skipped / 0 failed; desktop suite **445 passed** / 0 failed; lint, `tsc -b`, check-architecture (0 errors), check:tampering, check:prompts, security:check, and check:audit-prod (0 blocking) all clean. CI, Nightly, and Installer-smoke workflows green on the branch.

## Known gaps / follow-ups

Forward-tier follow-ups (none blocking) are tracked in [known-gaps.md](known-gaps.md): `T023.P3.A` (the published skills flow through `nexus skills sync` once the Hub cuts a release containing `develop`), `HUB.P3.EXT.*` / `HUB.P3.NS` (future Hub-surface optionality), and the two Hub-validator gaps that remain Nexus-Hub-repo-owned.
