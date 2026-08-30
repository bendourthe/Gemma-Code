# Nexus 2.4.1 - Release Notes

**Release status**: integration candidate; inherited global gates remediated or exact-count baselined, packaged field evidence still pending
**Target date**: 2026-08-29
**Packaged platform**: Windows 10/11 x86_64 through the complete one-file installer

v2.4.1 repairs the reported installer and image-runtime failures, refines transcript metadata and reasoning presentation, adds reversible chat archives, aligns model presentation, and turns Agents into a durable multi-root workspace experience.

## Highlights

- **Reliable installer progress and recovery**: the overall progress bar is larger than phase bars, reports a monotonic percentage, animates a gradient with reduced-motion support, and keeps optional provisioning failures inside the wizard. Frozen manifests include the pinned Unsloth and diffusion inputs they consume.
- **Correct embedding default and compatibility order**: EmbeddingGemma 300M is the required app-wide embedder, Nomic remains an opt-in legacy alternative, and models that exceed the detected host budget sort below every compatible model in both installer and Settings.
- **Browser-assisted gated downloads**: gated Hugging Face models retain the required publisher-consent page, then use browser device authorization and repository-access validation instead of requiring token copy/paste. Manual token entry and model skipping remain available fallbacks.
- **Verified diffusion readiness**: image generation refuses to advertise ready until the selected runtime has its required weights and a CUDA-capable torch build. Repair staging is atomic and preserves the last known-good environment.
- **Quieter transcript chrome**: composing motion sits directly on the transcript canvas. Completed responses alone use assistant bubbles. Time and total tokens are separated, detailed token counts are available on hover/focus, and provider reasoning is collapsed above the answer when available.
- **Archives across all pillars**: delete and archive both confirm and reset an active view. Archives remain durable and restorable from Settings, grouped by Chatbot, Agents, Images, and Videos.
- **One model display policy**: installer and Settings share catalog order and card facts. Storage size is a pill, VRAM appears with compatibility, every catalog model has summary copy, downloaded highlighting is restrained, and the disk meter uses live free-space data.
- **Multi-root Agents workspaces**: Agents starts at the OS home directory, supports one primary plus additional local folders, snapshots roots per session, guards every selected root, and groups history under durable workspace identities. The top tabs are Chat, Memory, and Activity.

## Support and Evidence

Automated behavior is supported at unit/integration level. Packaged Windows visuals, real NVIDIA image generation, thinking-model reasoning disclosure, four-pillar archive operation, installer/Settings visual parity, live disk changes, non-Windows pickers, and Windows kernel-enforced multi-root confinement are not proven here. See [known gaps](known-gaps.md) and the [operator checklist](development/v2.4.1-operator-checklist.md).

Local aggregate tests and release-owned lint/build/security checks pass. Inherited Rust formatting and installer Ruff drift were remediated. Intentional historical `nexus-check` findings are covered by an exact-count baseline that fails on excess or stale entries. Package metadata is 2.4.1; the first integration push and packaged Windows rebuild proceed under T048, while the field observations above remain explicit known gaps.

## Compatibility and Rollback

- Existing single-root Agent sessions migrate through the retained `workspacePath` compatibility field and appear under `Legacy workspace / Unsorted` when no scope metadata exists.
- Existing chat and studio sessions receive additive archive fields; restore does not rewrite transcript content.
- External model weights without catalog metadata remain visible as external entries rather than receiving invented facts.
- Roll back by reinstalling v2.3.1. Keep a copy of `~/.nexus/` before downgrading if you need to preserve newly archived sessions or multi-root workspace metadata.

Plan: [v2.4.1 field reliability](plans/v2.4.1-field-reliability-chat-archives-models-workspaces.md).
