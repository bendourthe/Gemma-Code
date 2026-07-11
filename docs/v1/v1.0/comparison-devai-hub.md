# Nexus v1.0.0 vs DevAI-Hub - Comparison and Upstream-Sync Plan

> **Version**: v1.0.0 (planning cycle)
> **Generated**: 2026-05-17
> **Analyzer**: Claude Code -- `/compare-project` skill (single-source: DevAI-Hub)
> **Source**: [bendourthe/DevAI-Hub](https://github.com/bendourthe/DevAI-Hub) (main branch)
> **Companion docs**: [pivot-brief.md](pivot-brief.md), [comparison-comfyui.md](comparison-comfyui.md), [docs/archive/versions/v0/v0.7.0/comparison-multi-source-v2.md](../../versions/v1/v0.7.0/comparison-multi-source-v2.md), [docs/archive/versions/v0/v0.7.0/plans/adoption-multi-source.md](../../versions/v1/v0.7.0/plans/adoption-multi-source.md)

## 1. Summary

DevAI-Hub is the project lead's own (bendourthe) cross-platform catalog of prompt, context, and harness engineering artefacts -- 197 skills across 22 categories, 33-35 slash commands, 14 hooks, 10 sub-agents, language-specific rules, an MCP registry policy, and one-click installers for Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. Unlike third-party projects (which the [pivot brief](pivot-brief.md) section 4 says we reverse-engineer behind a Nexus-native module), DevAI-Hub is **the one external project Nexus deliberately links to as an upstream feed**. The product constraint in pivot brief section 4.4 is binding: the v1.0.0 plan must include a `nexus skills sync` pathway that pulls the latest DevAI-Hub catalog into Nexus's Agentic AI Coding module (and, where relevant, the Local Chatbot Explorer's skill awareness) without manual copy-paste. The sync strategy proposed here is a **pinned-tag, sparse-clone, content-addressed pull** into `~/.nexus/skills/devai-hub/<tag>/`, namespaced as `devai-hub/<skill-name>` to avoid collisions with the in-tree `src/skills/catalog/`, surfaced through the existing `SkillLoader` + `WorkflowDetector` + `CurationLoop`, and respected by the local-first thesis (manual `nexus skills sync` by default, opt-in weekly background pull). The installer ships a baseline bundle so first launch already has the catalog lit up.

## 2. DevAI-Hub - what it is and what it ships

DevAI-Hub describes itself as a "cross-platform layer of prompt, context, and harness engineering" that injects behavioural rules, autonomous skills, and structured workflows into AI agents. It runs **local-first** (no telemetry, no third-party data processors, no outbound calls from skills), supports **Claude Code, Codex, Gemini, Cursor, and GitHub Copilot** as install targets, and lives at `bendourthe/DevAI-Hub` on GitHub. The repository top level contains a `catalog/` subtree (the shippable artefacts), `templates/ai-instructions/` (platform-specific install templates), `data/` (skill index + marketplace JSON), `scripts/` (installer + helper Python/Bash), `extensions/` (reverse-engineered internal MCP servers), `Makefile` (validate + lint), and platform installers (`.bat` for Windows, `.sh` for macOS/Linux).

### 2a. Skills (`catalog/skills/<category>/<name>/SKILL.md`)

**197 skills across 22 categories.** The full index (the same one the global CLAUDE.md mirrors verbatim) covers: `ai-development`, `architecture`, `bug-fixing`, `business-product`, `code-cleanup`, `code-review`, `compliance`, `developer-experience`, `documentation`, `framework-specialists`, `infrastructure`, `language-specialists`, `orchestration`, `project-setup`, `research`, `security`, `specialized-domains`, `testing`, `tests-generation`, `workflow`, plus the meta-categories implied by entries like `ai-billing-safeguards`. Each skill is a self-contained directory with a `SKILL.md` whose YAML frontmatter follows the agentskills.io standard plus DevAI-Hub's enrichment:

```yaml
---
name: <skill-name>
description: <trigger phrases + skip guidance>
summary_l0: "<<=15 words>"          # Tier-1 always-loaded summary
overview_l1: "<<=150 words>"        # Tier-1 always-loaded overview
---
```

Mandatory body sections: **When to Use This Skill**, **Instructions**, **Common Rationalizations** (table format with failure-mode citations), **Verification** (binary checklist with observable artefacts), **Related Skills**. The loading model is **three-tier**: tier 1 (~150-300 tokens, always loaded) for routing decisions; tier 2 (the SKILL.md body, target <=500 lines, soft cap 800) loaded on trigger; tier 3 (bundled `scripts/`, `references/`, `assets/` subdirectories) loaded on demand. The reference rule is enforced: every bundled file must be cited at least once in SKILL.md, validated by `make validate`.

### 2b. Slash commands (`catalog/commands/<name>.md`)

**33-35 commands**, plain Markdown, no agent-specific runtime hooks. Commands visible in the user's active install include: `setup-project`, `implement-phase`, `run-deep-review`, `update-version`, `analyze-codebase`, `check-usage`, `commands-cheatsheet`, `compare-project`, `compile-deep-research`, `continue-session`, `create-skill-or-command`, `generate-changelog`, `generate-commit-message`, `generate-devlog`, `generate-plan`, `generate-readme`, `generate-report`, `generate-sbom`, `generate-session-history`, `generate-tests`, `generate-todos`, `generate-unit-tests`, `implement-phase`, `import-skills`, `install-pre-commit-review-hook`, `manage-memory`, `refactor-docs`, `refactor-project-layout`, `review-codebase`, `run-deep-review`, `run-penetration-test`, `run-security-audit`, `search-skills`, `setup-project`, `tdd`, `update-devlog`, `update-documentation`, `update-gitignore`, `update-version`, `wrap-up-session`, `ship-and-babysit`, `update-config`, `keybindings-help`, `simplify`, `fewer-permission-prompts`, `loop`, `schedule`, `claude-api`, `init`, `review`, `security-review`.

### 2c. Sub-agents (`catalog/agents/<name>.md`)

**10 agents** declared as YAML-frontmatter Markdown files. Categories include PR-ops helpers (`pr-manager`, `pr-manager-lite`), progress-tracking (`taskmaster`), and others surfaced through `data/skills.json`. The two `pr-manager*` agents and `taskmaster` are already present in the Nexus repo under `.claude/agents/` as agent-agnostic Markdown -- evidence that the upstream-feed pattern already works.

### 2d. Hooks (`catalog/hooks/<name>.{sh,py}` + `settings.json` registration)

**14 hooks** distributed as executable scripts (Python or Bash, occasionally PowerShell `.ps1`) and registered in a `settings.json` hooks block. Categories include **PreToolUse** safety gates (e.g. `format-bash-description.py` and `format-powershell-description.py` from the user's global setup, `require-description.sh`, `require-powershell-description.sh`, the git-guardrails hook that enforces destructive-command confirmation, prompt-policy scanners for secrets) and **Stop** hooks for usage monitoring and session wrap-up. Trigger events are PreToolUse (every Bash/PowerShell/Edit/Write call), Stop (session end), and similar harness lifecycle moments.

### 2e. Rules (`rules/<lang>/<topic>.md`)

Per-language guardrail rules visible in the user's setup: `bash/{code-style,security}.md`, `go/{code-style,security,testing}.md`, `python/{code-style,security,testing}.md`, `typescript/{code-style,security,testing}.md`. These are concise (~40-60 line) "do/don't" cheatsheets a coding agent should treat as compile-time constraints when the active language is detected (e.g. "always parameterized SQL", "no `eval()` on user input", "`gofmt` required", "use Zod at boundaries").

### 2f. MCP registry policy (`catalog/mcp-configs/mcp-servers.json` + governance)

A **strict five-step decision tree** governs every proposed MCP entry (stop at first match): (1) **local-only** (DevAI-Hub internal or zero-outbound Anthropic-official) -- always allowed; (2) **LLM-native skill** (capability achievable by instructing the agent directly) -- ship a skill, not an MCP; (3) **reverse-engineered local MCP** under `extensions/` -- strip external attribution, generic names; (4) **trusted vendor wrapper (your-own-account)** -- acceptable only when all three of (vendor is intrinsic data destination, capability cannot be reverse-engineered, feature is worth it) hold, with `_comment` justification; (5) **otherwise drop**. **Hard-No list**: search-as-service, embeddings-as-service, scraping-as-service, generation-as-service (e.g. Upstash, Exa, Firecrawl, Zilliz). Every registry entry's `_comment` must answer five audit questions: who runs the process, what outbound calls, what API keys, does it transmit source/prompts/queries to third parties, does the user hold an existing commercial relationship.

### 2g. Other top-level surfaces

- **`catalog/checklists/`** -- structured pre-commit / shipping / clean-state checklists.
- **`catalog/context/`** -- shared context fragments injectable into prompts.
- **`catalog/memory/`** -- memory-file templates (memory layouts an agent can adopt).
- **`catalog/style-guides/`** -- language and writing style guides.
- **`templates/ai-instructions/base-*.md`** -- five platform-specific install templates (Claude / Codex / Gemini / Cursor / Copilot) that must be edited in lockstep.
- **`data/SKILL_INDEX.md`**, **`data/skills.json`**, **`data/marketplace.json`** -- the index that the installer reads for index placeholders and that downstream agents query via `search_skills` MCP.
- **Agent registry, spending controls, env-vars reference** -- top-level CLAUDE.md placeholders (`{{AGENT_REGISTRY}}`, `{{SPENDING_CONTROLS}}`, `{{ENV_VARS_REFERENCE}}`, `{{MCP_STATUS}}`) populated at install time.
- **Installer behaviour** -- `.bat` / `.sh` scripts that (1) deploy skills to `.claude/skills/`, (2) register commands in `.claude/commands/`, (3) configure hooks in `catalog/hooks/settings.json`, (4) generate `copilot-instructions.md` per language, (5) preserve existing user customizations (non-destructive merge).

## 3. What Nexus already inherits from prior comparison cycles

The v0.7.0 multi-source v2 comparison and the v0.7.0 - v0.9.0 adoption plans already pulled many DevAI-Hub-shaped patterns into Nexus in **skill-native** form (not vendored). This is the existing posture; the v1.0.0 sync pathway extends it from "we re-implement the patterns" to "we also pull the upstream catalog directly". Mapping:

| DevAI-Hub artifact type | Adopted in current `src/` | Where | Adoption mode |
|---|---|---|---|
| SKILL.md YAML frontmatter (agentskills.io alignment) | Yes (v0.8.0 Phase 2, D1) | [src/skills/SkillLoader.ts](../../../src/skills/SkillLoader.ts) parses `name`, `description`, `argument-hint`, `version`, `platforms`, `metadata.tags`, `metadata.related_skills` | Skill-native (we wrote our own parser; format aligned) |
| In-tree skill catalog | Yes -- 17 skills | `src/skills/catalog/{commit,polish,critique,distill,harden,animate,build-second-brain,council,lens,incident-commander,review-pr,setup-project,generate-{changelog,readme,tests},analyze-codebase}/` | Skill-native (skills authored from scratch; patterns drawn from S5/DevAI-Hub) |
| Multi-harness skill packaging | Yes (v0.7.0 Phase 7, C29) | `scripts/package-skills.mjs` emits `dist/{cursor,claude-code,opencode,gemini-cli}/` | Skill-native exporter (reverse of DevAI-Hub's installer direction) |
| Auto-skill harvest from repeated workflows | Yes (v0.8.0 Phase 6.4, D4) | [src/skills/WorkflowDetector.ts](../../../src/skills/WorkflowDetector.ts), n-gram tool-sequence detection, write proposals to `~/.gemma-code/skills/proposed/<slug>/SKILL.md` | Skill-native (DevAI-Hub-style hermes-skill-factory pattern) |
| Per-skill success metrics | Yes (v0.8.0, D5) | [src/skills/SkillMetrics.ts](../../../src/skills/SkillMetrics.ts) | Skill-native |
| Dual-loop curator with dry-run + rollback | Yes (v0.8.0, D6/D7) | [src/skills/CurationLoop.ts](../../../src/skills/CurationLoop.ts) | Skill-native |
| Sub-agents as agent-agnostic Markdown | Yes | `.claude/agents/{pr-manager,pr-manager-lite,taskmaster}.md` + [src/agents/SubAgentManager.ts](../../../src/agents/SubAgentManager.ts) loads `assets/specialists/<role>.md` | Vendored as plain MD (the three `.claude/agents/*.md` files are mirrored from DevAI-Hub's catalog) |
| Slash commands as plain MD | Partial | `.claude/commands/ship-and-babysit.md` is mirrored from DevAI-Hub; the other ~25 slash commands live in Nexus's `CommandRouter` and have not yet been re-expressed as catalog Markdown | Mixed -- one vendored MD, the rest are TS-imperative |
| Improvement-hook files (user-editable Markdown at `~/.gemma-code/hooks/`) | Yes (v0.8.0 Phase 3.4, B7) | [src/chat/ImprovementHook.ts](../../../src/chat/ImprovementHook.ts) -- reads `enterplanmode-improve.md`, scans for prompt-injection, injects as system message | Skill-native (modelled on plannotator/DevAI-Hub user-hook surface) |
| Hook scripts with stdin-JSON / stdout-decision protocol | Yes | `scripts/hooks/check-{tool-permission,git-control-plane,prompt-policy}.mjs` | Skill-native (3 hooks; DevAI-Hub ships 14) |
| MCP Registry Policy (decision tree + 5-question audit) | Yes | [AGENTS.md](../../../AGENTS.md) "MCP Registry Policy" + [src/mcp/McpManager.ts](../../../src/mcp/McpManager.ts) Zod schema enforces local-only command, env whitelist, no remote endpoints | Vendored verbatim as documentation; enforced in code |
| Memory file architecture (Instructions/Memory/Context/Archive) | Yes (v0.7.0 Phase 3, C17) | `~/.gemma-code/memory/<workspaceId>/{Instructions,Memory,Context}.md + Archive/`, consumed by PromptBuilder | Skill-native (modelled on Hermes `MEMORY.md` + DevAI-Hub `memory/` templates) |
| Prompt-injection scanner at memory + context boundary | Yes (v0.8.0, G1) | [src/guardrails/PromptInjectionScanner.ts](../../../src/guardrails/PromptInjectionScanner.ts) used by `ImprovementHook` | Skill-native |
| Three-tier skill loading (L0 summary / L1 overview / L2 body) | Partial | SkillLoader exposes `metadata.tags` and `metadata.related_skills`; we do not yet implement the `summary_l0` / `overview_l1` Tier-1 always-loaded frontmatter or the on-demand `scripts/`/`references/`/`assets/` bundle convention | Gap to close in v1.0.0 sync |
| Per-language rules (`rules/<lang>/<topic>.md`) | Not yet | (none in `src/`; the user has them globally) | Gap to close in v1.0.0 sync |
| Top-level installer that ships skills + commands + hooks + rules | Not yet (we have a Python/PyQt installer but it provisions runtime, not the skill catalog) | Gap to close in v1.0.0 sync (installer should embed a baseline DevAI-Hub bundle) |
| Skills index JSON for `search_skills` MCP | Not yet | DevAI-Hub ships `data/skills.json`; Nexus does not yet expose a comparable index | Gap to close in v1.0.0 sync |
| Spending controls / env-vars reference / agent registry template blocks | Not yet | Gap |

**Net posture going into v1.0.0**: the *patterns* are largely adopted; the *catalog itself* and the *upstream sync wiring* are not. The v1.0.0 cycle closes that loop.

## 4. The Sync Pathway (the heart of this doc)

This section designs the `nexus skills sync` subcommand. It is the **one concrete deliverable** this comparison demands from the v1.0.0 plan beyond skill adoptions.

### 4.1 Upstream identity and version policy

- **Remote**: `https://github.com/bendourthe/DevAI-Hub.git`.
- **Branch policy**: pinned tags by default (`v1.0.0`, `v1.1.0`, etc.), with an opt-in `--branch=main` for power users who want bleeding-edge. DevAI-Hub already uses semver-ish releases; if a tag is missing, fall back to a pinned commit SHA.
- **Provenance ledger**: every sync writes `~/.nexus/skills/devai-hub/manifest.json` with `{ tag, commit_sha, fetched_at, content_hash, manifest_hash }`. The trace dashboard surfaces this when displaying any skill loaded from DevAI-Hub.

### 4.2 In-scope subset (what we pull, what we leave behind)

| DevAI-Hub artifact | In scope? | Notes |
|---|---|---|
| `catalog/skills/<cat>/<name>/SKILL.md` + bundles | Yes -- **all 197** | Tier-1 frontmatter pre-indexed at sync time; bundles fetched lazily on first use |
| `catalog/commands/<name>.md` | Yes -- whole catalog | Imported into Nexus's coding-module slash-command surface; tagged as `devai-hub/<name>` |
| `catalog/agents/<name>.md` | Yes -- whole catalog | Registered in `SubAgentManager` under the `devai-hub/` namespace |
| `catalog/hooks/<name>.{sh,py,ps1}` + settings | **Opt-in only** | Hooks execute arbitrary code; default-off; user must `nexus skills sync --enable-hooks=<names>` after auditing. The 3 in-tree `scripts/hooks/check-*.mjs` are never replaced. |
| `rules/<lang>/<topic>.md` | Yes -- whole catalog | Lazy-loaded by Coding module when it detects the active language |
| `catalog/mcp-configs/mcp-servers.json` | Policy text yes; entries audited | Vendored as documentation; individual server configs evaluated against Nexus's own `McpManager` Zod schema; only `local-only` entries auto-register |
| `catalog/checklists/`, `catalog/context/`, `catalog/memory/`, `catalog/style-guides/` | Yes | Loaded into the corresponding Nexus surfaces (CleanStateChecker, ContextBuilder, MemoryFile templates, style-guide tab) |
| `templates/ai-instructions/base-*.md` | **No** | Nexus speaks its own UI; these target other agent harnesses |
| `data/skills.json`, `data/marketplace.json` | Yes | Source of truth for the in-app skill browser |
| `extensions/` (internal MCP servers) | Yes -- whole catalog | Pulled into `~/.nexus/extensions/devai-hub/` and surfaced through `McpManager` as candidate local servers |
| `scripts/` (Python/Bash helpers bundled into skills) | Yes (lazy) | Fetched on first tier-3 load; sandboxed under `~/.nexus/sandbox/` |
| `.bat`/`.sh` installer scripts | **No** | Nexus has its own installer; DevAI-Hub's installer targets the .claude / .codex / etc directories, which Nexus does not own |

### 4.3 Pull mechanism

**Default**: lightweight git clone of the pinned tag into `~/.nexus/skills/devai-hub/<tag>/` using **sparse-checkout** so only the in-scope subtrees land on disk:

```bash
git clone --depth=1 --branch <tag> --no-checkout \
    https://github.com/bendourthe/DevAI-Hub.git ~/.nexus/skills/devai-hub/<tag>/
cd ~/.nexus/skills/devai-hub/<tag>/
git sparse-checkout init --cone
git sparse-checkout set catalog/ rules/ data/ extensions/
git checkout <tag>
```

**Fallback for offline-first laptops**: GitHub tarball download via `https://github.com/bendourthe/DevAI-Hub/archive/refs/tags/<tag>.tar.gz`, content-hash verified against a baked-in SHA index shipped with the Nexus installer. No git required.

**Why not submodule**: submodules couple Nexus's git state to DevAI-Hub's; we want the user (and the installer) to be able to update the catalog independently of a Nexus release.

**Why not vendor-in-tree**: bloats the Nexus repo with 197 skills that have their own upstream; rebases get ugly.

### 4.4 Namespace and conflict resolution

Skills loaded from DevAI-Hub are namespaced **`devai-hub/<skill-name>`** when registered with `SkillLoader`. In-tree skills under `src/skills/catalog/` remain unprefixed (e.g. `commit`, `polish`). When DevAI-Hub ships a skill with the same name as an in-tree skill (the v0.8.0 cycle authored `polish`, `critique`, `distill`, etc. as Nexus-native; DevAI-Hub also ships `simplify`, `code-simplification`, etc.):

- The user-facing name in `/help` and the skill browser shows both, prefixed by their namespace.
- The harness routes to whichever the user invoked by full name.
- When the user invokes by bare name, in-tree wins by default; a settings flag `nexus.skills.preferUpstream = true` flips the default.
- A "diverged" badge appears in the skill browser when two same-named skills have non-trivial content drift; the user can compare side-by-side and pick which becomes default.

### 4.5 Hot reload

Nexus already has the wiring: [src/skills/SkillLoader.ts](../../../src/skills/SkillLoader.ts) reads the skills directory, [src/skills/WorkflowDetector.ts](../../../src/skills/WorkflowDetector.ts) proposes new ones, [src/skills/CurationLoop.ts](../../../src/skills/CurationLoop.ts) runs the dual-loop curator. `nexus skills sync` finishes with a `SkillLoader.reload()` call that re-scans both `src/skills/catalog/` (in-tree) and `~/.nexus/skills/devai-hub/<tag>/catalog/skills/` (upstream). The Coding module re-renders its system prompt on the next turn; no extension restart, no daemon kick.

### 4.6 Provenance

Each loaded skill carries a `source` field on its `Skill` record:

```ts
type SkillSource =
  | { kind: "in-tree" }
  | { kind: "devai-hub"; tag: string; commit: string; fetchedAt: number }
  | { kind: "user-proposed"; slug: string }     // WorkflowDetector output
  | { kind: "user-installed"; path: string };   // workspace-local SKILL.md
```

The trace dashboard, the skill browser, and the per-skill metrics panel all display this. When an upstream-sourced skill misbehaves, the trace surfaces `devai-hub@v1.3.2/<skill-name>` so the user can pin or roll back.

### 4.7 Update cadence

Default is **manual**: the user runs `nexus skills sync` from the command palette, the CLI, or the dashboard "Update Skills" button. The local-first thesis forbids silent background pulls.

**Opt-in weekly background pull**: `nexus.skills.autoSync = "weekly"` (or `"daily"` / `"never"`). When enabled, the curator's idle scheduler ([src/agents/IdleTimeScheduler.ts](../../../src/agents/IdleTimeScheduler.ts)) runs the sync, surfaces a "X new skills available" notification, and waits for explicit accept before activating the new bundle. Activation is therefore always explicit; only the fetch is automated.

**Failure behaviour**: a failed sync (network, hash mismatch, schema violation) does not touch the active bundle. The user keeps whatever they had; the trace logs the failure with the upstream commit it tried to land.

### 4.8 Skill quality gates at sync time

Every incoming SKILL.md is validated before being marked active:

1. **Frontmatter**: must parse; required keys present (`name`, `description`); `summary_l0` length <= 15 words; `overview_l1` length <= 150 words.
2. **Body sections**: target sections present (When to Use, Instructions, Verification). Missing sections degrade the skill to "preview" (visible in the browser, not auto-triggered).
3. **Prompt-injection scan**: [src/guardrails/PromptInjectionScanner.ts](../../../src/guardrails/PromptInjectionScanner.ts) runs over every SKILL.md body and every bundled `scripts/`/`references/`/`assets/` file before they are loaded. A hit drops the skill with a warning and a trace entry.
4. **Bundle reference check**: every bundled file must be referenced in SKILL.md (DevAI-Hub's `make validate` rule, re-enforced locally).
5. **Hooks audit**: hooks are never auto-activated even when in scope; the `--enable-hooks=<names>` flag goes through a per-hook code review prompt that displays the hook content and asks for confirmation.

### 4.9 CLI surface (proposal)

```
nexus skills sync                              # pull latest pinned tag
nexus skills sync --tag v1.4.0                 # pull a specific tag
nexus skills sync --branch main                # bleeding edge (advanced)
nexus skills sync --dry-run                    # show what would change
nexus skills sync --enable-hooks <name>...     # opt in to specific hooks
nexus skills list                              # list active skills + sources
nexus skills info devai-hub/<name>             # show provenance + diff vs in-tree
nexus skills pin <namespace>/<name> <version>  # pin one skill at an older tag
nexus skills rollback                          # restore previous bundle
```

A GUI equivalent lives in the Coding module's "Skills" panel (table view, source badge, version dropdown, "Update available" indicator).

## 5. What from DevAI-Hub goes where in Nexus

| DevAI-Hub asset | Target Nexus surface | Notes |
|---|---|---|
| `catalog/skills/<cat>/<name>/SKILL.md` | Coding module skill catalog (primary) + Local Chatbot Explorer's skill awareness (subset of high-value chat-relevant skills like `writing-editing`, `analysis-logic`, `creative-generation`) | Routed via `SkillLoader.reload()`; tier-1 frontmatter always loaded |
| `catalog/commands/<name>.md` | Coding module slash commands (verbatim, namespaced `devai-hub/<name>`) + Chat module subset (commands like `/manage-memory`, `/wrap-up-session`, `/check-usage`, `/commands-cheatsheet` make sense in chat too) | The Coding module's `CommandRouter` learns to dispatch into vendored MD commands by reading the prompt body and treating it as a skill invocation |
| `catalog/agents/<name>.md` | `SubAgentManager` (already loads `assets/specialists/<role>.md`); new path `~/.nexus/skills/devai-hub/<tag>/catalog/agents/` is added to the search order, prefixed `devai-hub/` | The three existing in-tree agents (`pr-manager`, `pr-manager-lite`, `taskmaster`) become unprefixed in-tree variants; their DevAI-Hub originals stay accessible under `devai-hub/` |
| `catalog/hooks/<name>.{sh,py,ps1}` + settings | Nexus tool-hook system (existing `improvementHook`, the three `scripts/hooks/check-*.mjs`, `WorkflowDetector`-adjacent) -- **opt-in** | Defaults off. Each hook surfaces in Settings UI with an "Audit & Enable" toggle; the existing `PromptInjectionScanner` runs over the hook body before enablement |
| `rules/<lang>/<topic>.md` | Per-language guardrail rules; injected into the Coding module's `PromptBuilder` when the active file's language is detected | Lazy: only the languages observed in the session are loaded; budgeted against the existing `PromptBuilder` token allocation |
| `catalog/mcp-configs/mcp-servers.json` | `McpManager` configuration template + Settings UI's "Add MCP Server" dialog | The five-step decision tree is rendered as inline guidance in the dialog; user-added servers are scored against it |
| `catalog/checklists/` | "Pre-commit" + "Wrap-up session" surfaces (already exists as `/wrap-up-session`); new "Cleaning state" checklists feed `CleanStateChecker` | One-per-checklist render in the Coding module |
| `catalog/context/` | `ContextBuilder` injectable fragments (the same pipeline that handles `Memory.md`/`Context.md`) | User picks which fragments to enable per workspace |
| `catalog/memory/` | Memory-file templates surfaced in `/memory init` | First-launch wizard offers a "use DevAI-Hub baseline" option |
| `catalog/style-guides/` | Local Chatbot Explorer "Writing Style" picker + Coding module "Comment Style" override | Two consumers, one source |
| `data/SKILL_INDEX.md`, `data/skills.json`, `data/marketplace.json` | In-app skill browser (Coding module + Chat module) | The `search_skills` MCP-style behaviour DevAI-Hub describes becomes a local function call; no network |
| `extensions/` (internal MCP servers) | `McpManager` candidate-server list | All flagged `local-only`; the user enables individually |
| `templates/ai-instructions/base-*.md` | **Not adopted** | Nexus is its own harness; these target downstream agent installs |
| Top-level installer (`.bat`/`.sh`) | **Not adopted** | Nexus installer is sovereign |

## 6. New adoptions for v1.0.0

Concrete code/doc work the v1.0.0 plan must schedule.

1. **`nexus skills sync` subcommand**. Implements the sync pathway in section 4. Subcommands: `sync`, `list`, `info`, `pin`, `rollback`. Wires sparse-checkout + tarball-fallback. Writes `~/.nexus/skills/devai-hub/manifest.json`. Calls `SkillLoader.reload()` on success. **Modules**: new `src/skills/UpstreamSync.ts` (or `coding/skills/UpstreamSync.ts` post-refactor); new CLI verb in the Nexus binary; new Settings UI panel. **Mode**: skill-native (we own the code) + vendor-as-is (we pull DevAI-Hub's data). **Scope**: L. **Dependencies**: the v1.0.0 desktop shell + IPC surface; the `coding/` module decomposition.

2. **Tier-1 always-loaded frontmatter (`summary_l0`, `overview_l1`)**. Extend `SkillLoader` to parse these fields, default sensibly when missing (use first 15 / first 150 words of `description`), and surface them in the skill browser. Required for the three-tier loading model to actually save tokens. **Modules**: `src/skills/SkillLoader.ts`, `src/skills/SkillMetrics.ts`. **Mode**: skill-native. **Scope**: S. **Dependencies**: none.

3. **On-demand bundle loading (`scripts/`/`references/`/`assets/`)**. Implement tier-3 lazy fetch of bundled files from `~/.nexus/skills/devai-hub/<tag>/catalog/skills/<cat>/<name>/{scripts,references,assets}/`. Sandbox execution of bundled scripts (no implicit shell escape; user confirms first). **Modules**: `src/skills/SkillLoader.ts` + new `src/skills/SkillBundleLoader.ts`. **Mode**: skill-native. **Scope**: M. **Dependencies**: upstream sync.

4. **Per-language rule injection**. New `src/coding/LanguageRules.ts` that reads `~/.nexus/skills/devai-hub/<tag>/rules/<lang>/*.md`, caches in-memory, injects the matching guardrail block into `PromptBuilder` when the active file's language matches. **Modules**: `src/chat/PromptBuilder.ts`, new `src/coding/LanguageRules.ts`. **Mode**: vendor-as-is via sync. **Scope**: M. **Dependencies**: upstream sync; language detector (already exists via file extension).

5. **DevAI-Hub commands routed through `CommandRouter`**. Teach `CommandRouter` to dispatch `/devai-hub/<name>` (and bare `/<name>` when unambiguous) by reading the vendored `.md` body and invoking it as a skill-style turn. **Modules**: `src/commands/CommandRouter.ts`. **Mode**: vendor-as-is via sync. **Scope**: M. **Dependencies**: upstream sync.

6. **`SubAgentManager` upstream search path**. Add `~/.nexus/skills/devai-hub/<tag>/catalog/agents/` to the load order after `assets/specialists/` and workspace overrides. Apply `devai-hub/` namespace. **Modules**: `src/agents/SubAgentManager.ts`, `src/agents/SpecialistLoader.ts`. **Mode**: vendor-as-is via sync. **Scope**: S. **Dependencies**: upstream sync.

7. **Hooks opt-in surface**. New Settings UI section "External Hooks (DevAI-Hub)" with one toggle per hook, each gated by a confirmation that displays the hook body and the `PromptInjectionScanner` verdict. Hooks are registered with the existing improvement-hook plumbing. **Modules**: `src/chat/ImprovementHook.ts`, new Settings panel. **Mode**: vendor-as-is via sync; default off. **Scope**: M. **Dependencies**: upstream sync; the existing scanner.

8. **MCP policy embedded in Settings UI**. The five-step decision tree from section 2f becomes inline guidance in the "Add MCP Server" dialog. The five-question audit becomes mandatory text fields in the entry's `_comment`. The hard-no list is enforced as a denylist when adding a server. **Modules**: `src/mcp/McpManager.ts` + new Settings UI dialog. **Mode**: skill-native (we already enforce the policy in `McpManager`; this just exposes it). **Scope**: M. **Dependencies**: desktop shell.

9. **Skill browser UI** (Coding module + Chat module). Table view of all loaded skills with: name, source badge (`in-tree` / `devai-hub@<tag>` / `user-proposed` / `user-installed`), category, last-used, success rate, version, "Diverged" indicator. Inline diff view for diverged skills. **Modules**: new Coding module "Skills" panel; Chat module reuses the same component. **Mode**: skill-native UI. **Scope**: L. **Dependencies**: provenance fields (item 1), tier-1 frontmatter (item 2).

10. **Installer-bundled baseline catalog**. The Nexus Windows installer (`Nexus-1.0.0-Setup.exe`) ships a frozen DevAI-Hub bundle (the pinned tag at release time) inside the installer artefact, so first launch already has 197 skills lit up without a network call. The installer extracts to `~/.nexus/skills/devai-hub/<baseline-tag>/`. A subsequent `nexus skills sync` upgrades to the latest. **Modules**: `scripts/installer/` + the existing PyQt installer. **Mode**: vendor-as-is. **Scope**: M. **Dependencies**: upstream sync; installer cycle.

11. **`search_skills` local function**. A pure function over `data/skills.json` (vendored from DevAI-Hub) and the in-tree catalog that returns ranked matches for a free-text query. Used by the curator when proposing skills, by the user from the skill browser search box, and by the agent on prompts like "is there a skill for X". **Modules**: new `src/skills/SkillSearch.ts`. **Mode**: skill-native (function), vendor-as-is (data source). **Scope**: S. **Dependencies**: upstream sync.

12. **Spending-controls / env-vars / agent-registry template blocks**. Adopt DevAI-Hub's `{{SPENDING_CONTROLS}}`, `{{ENV_VARS_REFERENCE}}`, `{{AGENT_REGISTRY}}`, `{{MCP_STATUS}}` placeholders in Nexus's own startup banner / system prompt as live data blocks the user can inspect from Settings. **Modules**: `src/chat/PromptBuilder.ts`, new Settings panels. **Mode**: skill-native (we already have the data; we just need to surface it on the DevAI-Hub schema). **Scope**: S. **Dependencies**: none.

13. **Provenance in trace dashboard**. The existing trace dashboard learns the `SkillSource` field and renders it for every skill-bearing trace event. **Modules**: `src/observability/Tracer.ts`, the trace dashboard webview. **Mode**: skill-native. **Scope**: S. **Dependencies**: item 1.

14. **CHANGELOG + ADR**. ADR-00NN "DevAI-Hub upstream sync pathway" capturing namespace, pull mechanism, conflict resolution, cadence, security gates. CHANGELOG entry for v1.0.0 lists 197 skills, 33 commands, 10 agents, and 14 opt-in hooks now reachable via `nexus skills sync`. **Modules**: docs only. **Mode**: doc. **Scope**: S.

## 7. Risks and non-adoptions

- **Claude-Code-specific skills don't all translate.** Skills like `keybindings-help` (configures Claude Code's `~/.claude/keybindings.json`), `update-config` (edits `settings.json` for the Claude Code harness), `fewer-permission-prompts` (analyses Claude Code transcripts), and `claude-api` (Anthropic SDK migration) are tightly bound to the Claude Code harness. The sync surfaces them, but the Coding module marks them `compatibility: not-applicable` so they do not auto-trigger inside Nexus. They remain visible for users who run both Nexus and Claude Code on the same machine.
- **Cloud-touching MCP entries.** Any `catalog/mcp-configs/mcp-servers.json` entry that does not pass the local-only test under Nexus's `McpManager` Zod schema is parked in a "needs-review" tray, not auto-registered. The hard-no categories (search-as-service, embeddings-as-service, scraping-as-service, generation-as-service) are rejected outright, matching DevAI-Hub's own policy.
- **Hooks default off.** Even when in scope, every DevAI-Hub hook is opt-in per the section 4.8 audit. A poisoned upstream hook is the single most credible supply-chain risk; defaulting off and forcing the `PromptInjectionScanner` + a per-hook confirmation closes it.
- **Skills with embedded scripts that shell out.** Tier-3 `scripts/` files run inside a sandbox under `~/.nexus/sandbox/`, never inherit the user's full PATH, and require confirmation. The current `pathGuard` + `secretPaths` infrastructure already handles workspace-boundary checks; the sync layer reuses them.
- **DevAI-Hub renames a skill mid-flight.** If `devai-hub/old-name` becomes `devai-hub/new-name` upstream, our pin map (`nexus skills pin`) and the `data/skills.json` `aliases` field (if present) carry the rename. If neither, the sync logs the disappearance and the user keeps the pinned old version until they explicitly upgrade.
- **Catalog growth outpaces VRAM**. 197 skills today, plausibly 300+ in a year. Tier-1 frontmatter at ~200 tokens each is ~60 KB always loaded -- still under 2 % of an 8K context. The three-tier loading model is the whole reason this scales; if a future version of DevAI-Hub breaks the `summary_l0` convention, we degrade gracefully by hashing the first paragraph of each skill into a synthetic L0.
- **Top-level installer scripts (`.bat`/`.sh`) are not adopted.** They target `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.github/copilot/` directory layouts. Nexus owns its own filesystem and skill loader; mirroring those installer steps would create a second source of truth.
- **`templates/ai-instructions/base-*.md`** are not adopted for the same reason.
- **What stays in DevAI-Hub, not mirrored**: the per-harness `copilot-instructions.md` generator, the `make validate` / `make lint` build targets (Nexus has its own validation in the SkillLoader + curator), the test harness for skills, the marketplace JSON updaters (we just consume the published JSON), and the .vscode / .idea per-editor config.

## 8. Open questions for the plan generator

1. **Branch vs tag.** Default to pinned tags for sync, with `--branch=main` opt-in? Or default to `main` so the user is always close to upstream HEAD with a `--tag=<v>` rollback? Recommendation: pinned tag by default; the local-first thesis favours determinism over freshness.
2. **Installer-bundled baseline size.** Embedding a 197-skill bundle plus rules / agents / commands at release time adds ~2-5 MB to the installer (text + a handful of scripts). Acceptable? Or fetch on first launch and tolerate a one-time network call? Recommendation: ship the baseline so the installer-carries-everything constraint (pivot brief 4.5) holds even on offline laptops.
3. **MCP policy in Settings UI.** Should the five-step decision tree be a *modal* the user walks through every time they add an MCP server, or just inline help text? Modal increases friction (good for safety) but slows power users. Recommendation: modal on first add per session; collapsed inline help thereafter.
4. **Rename compat shim.** When DevAI-Hub renames a skill, do we keep the old name as an alias indefinitely, or expire it after N versions? Recommendation: indefinite alias with a "renamed in vX.Y" badge, because the user's muscle memory and saved workflow proposals reference the old name.
5. **Chat module skill scope.** Which DevAI-Hub categories make sense to surface in the Local Chatbot Explorer's skill awareness? Recommendation: `developer-experience/{writing-editing,analysis-logic,creative-generation}`, `research/{trend-research,local-docs-lookup}`, `business-product/{technical-writer,internal-comms}`, `specialized-domains/{theme-tokens,brand-styling,deep-research-compilation}`, and the workflow category whose surface is naturally chat-shaped. Coding-specific categories stay coding-only.
6. **Skill divergence resolution.** When an in-tree skill (`polish`) and an upstream skill (`devai-hub/code-simplification`) overlap by intent, do we merge, deprecate one, or live with both? Recommendation: live with both for v1.0.0; revisit in v1.1.0 once telemetry shows which the user actually invokes.
7. **Telemetry of upstream usage.** Should the curator surface "you've never invoked any `compliance/` skill in 3 months; hide that category by default?" to keep the tier-1 budget tight? Recommendation: yes, with an "Always show all" override.
8. **Background pull governance.** If the user opts into weekly auto-sync, do we ever apply changes silently? Recommendation: never. Fetch silently; activate explicitly. The activate step always shows a diff summary first.
