# Skill-native adoptions (v1.19.1)

v1.19.1 Phase 1: Hub skill prose plus four verify-only coverage notes. No engine code. Do not add duplicate builtin skills under [`modules/coding/skills/catalog/`](../../modules/coding/skills/catalog/). Consume the Hub edits via `nexus skills sync` after they land on the Hub line; until then they live on Hub branch `feat/v1.19.1-skill-native-wins` (commit `451e508f`).

This note exists so Phase 2 does not rebuild prompting work the catalog already carries, and so the four verify-only dedups stay evidenced instead of turning into no-op tasks.

## 1.1 -- Grounded-citation verification (Hermes A3)

| | |
|---|---|
| **Source** | Hermes Herald comparison, [Section 4a A3](../v2/v2.0/comparisons/v2.0.1-comparison-hermes-agent.md) and [Section 7 Bucket 1](../v2/v2.0/comparisons/v2.0.1-comparison-hermes-agent.md) |
| **Covered by** | Nexus-Hub skill `deep-research-compilation` |
| **What landed** | Quote-verification (quoted passages must match fetched or extracted source text) plus a fact-check pass before finalize. Failure behavior: flag `[UNVERIFIED QUOTE]` / `[UNSUPPORTED]`, do not fabricate a matching quote or a prettier citation. |
| **What is not covered** | No new research tool, no engine-side quote matcher. |
| **New skill / MCP / code this cycle** | Hub skill prose only. |

Catalog id after namespacing: `nexus-hub/deep-research-compilation`. Upstream: [Nexus-Hub](https://github.com/bendourthe/Nexus-Hub).

## 1.2 -- Persona-card prompting for Chat (Airi skill-native)

| | |
|---|---|
| **Source** | Airi comparison, [Section 6 persona-card row](../v2/v2.0/comparisons/v2.0.3-comparison-airi.md) and [Section 7 Bucket 1](../v2/v2.0/comparisons/v2.0.3-comparison-airi.md) |
| **Covered by** | Nexus-Hub skills `prompt-engineering` (card construction: identity, voice, boundaries) and `creative-generation` (companion-voice application) |
| **What landed** | A persona-card template and a mapping onto existing surfaces. Coding: system-role slot. Chat: paste the card as the first user message and keep it in the thread. |
| **What is not covered** | Chat settings have no per-chat system-prompt field (`Chat` is title, modelId, folderId, contextScopeId). That field is a stretch follow-up for the v2.0.0 Chat phases, not a UI build here. |
| **New skill / MCP / code this cycle** | Hub skill prose only. No Airi code. |

A user following the skill can give a chat a stable persona today by keeping the card in the thread. Catalog ids: `nexus-hub/prompt-engineering`, `nexus-hub/creative-generation`.

## 1.3 -- Avatar script/audio-prep + transcript-reasoning (LongCat A5, Inkling skill-native)

| | |
|---|---|
| **Source** | LongCat comparison [Section 4a A5](../v2/v2.0/comparisons/v2.0.4-comparison-longcat-video.md); Inkling comparison [transcript-reasoning row](../v2/v2.0/comparisons/v2.0.5-comparison-inkling-small.md) |
| **Covered by** | Nexus-Hub skill `creative-generation` |
| **What landed** | (a) Talking-head prep: script pacing, TTS handoff, reference-photo framing, audio hygiene. (b) Transcript-reasoning: heard vs inferred, quote the STT span, do not silently "correct" the transcript. Both blocks are self-contained and name the Nexus features they pair with as "when available" (v2.0.0 Video Lab avatar mode, Phase 3; v2.0.0 audio bridge, Phase 1). |
| **What is not covered** | No avatar pipeline, no STT bridge, no weights. Those remain v2.0.0 / v1.19.2 builds. |
| **New skill / MCP / code this cycle** | Hub skill prose only. |

## 1.4 -- Verify-only dedups (one line of evidence each)

No builds. Confirmed against this tree and the Hub catalog on 2026-08-19.

| Item | Evidence |
|---|---|
| (a) QM scope-owned skills + git import | Covered by `nexus skills sync` ([`NexusHubSyncer.ts`](../../core/skills/NexusHubSyncer.ts), [`SkillInstaller.ts`](../../core/skills/SkillInstaller.ts), Settings > Skills "Sync now") plus per-project / user skill roots consumed by [`SkillCatalog`](../../core/skills/SkillCatalog.ts) (`builtin` > `user` > `nexus-hub`). No second import path. |
| (b) QM crons/watches | Dedups to OpenWorker A2. The local scheduler **has shipped**: [`modules/coding/autonomy/AgentRunScheduler.ts`](../../modules/coding/autonomy/AgentRunScheduler.ts) in v1.18.0 (morning-brief schedule off by default; every wake re-enters the permission tiers; no auto-approve). Not rebuilt here. |
| (c) Atomic lessons/procedures capture | Covered by Hub `continuous-learning` (local `.nexus/observations.jsonl` -> instincts YAML -> draft skills; zero outbound). Atomic C5's thin `lesson`/`procedure` memory-kind storage remains v2.0.0 stretch, not this phase. |
| (d) Atomic 17 starter playbooks | Covered by the Hub catalog as a whole (271 skills across 21 categories, including `agent-presets`, `runbook-writer`, `oncall-runbook`, `implementation-plan`). No playbook import. |

## How to verify (no rebuild)

1. On Hub: `python scripts/validate_skills.py --path catalog/skills/specialized-domains/deep-research-compilation --quality` (and the same for `prompt-engineering` and `creative-generation`). Expect 0 errors.
2. Confirm this repository did **not** add `deep-research-compilation`, `prompt-engineering`, `creative-generation`, or `continuous-learning` under [`modules/coding/skills/catalog/`](../../modules/coding/skills/catalog/).
3. After Hub merge, `nexus skills sync --apply` so `~/.nexus-ai/catalog/skills/` reflects the grounded-citation and persona-card sections.

Phase 2 is engine work (denials, loop guards, recovery). It does not re-author these skills.
