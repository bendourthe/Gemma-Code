# Gemma Code

> A local, agentic coding assistant for VS Code powered by Google's Gemma — no API keys, no data leaving your machine.

Gemma Code brings a Claude Code-style agentic workflow to VS Code, running entirely on your local hardware via [Ollama](https://ollama.com). It can read and edit files across your codebase, execute terminal commands, reason across multiple files simultaneously, and plan multi-step coding tasks — all without a network connection or a cloud subscription.

---

## Features

- **Fully offline** — all inference runs locally via Ollama; zero data is sent to external servers
- **Agentic tool use** — the assistant reads files, applies edits, runs shell commands, and searches the web using DuckDuckGo, iterating across multiple steps autonomously
- **Codebase-wide reasoning** — reads and understands multiple files simultaneously to make context-aware edits
- **Edit modes** — choose Auto (apply immediately), Ask (show diff and confirm), or Manual (show diff only, never write)
- **Plan mode** — the assistant produces a numbered plan and waits for step-by-step approval before acting
- **Slash commands and skills** — `/commit`, `/review-pr`, `/generate-readme`, and more built-in workflows; add your own skills to `~/.gemma-code/skills/`
- **Persistent history** — sessions are stored in a local SQLite database; resume any past conversation
- **4-layer memory system** — working memory (ephemeral task state), episodic memory (structured session events), semantic memory (FTS5 + embeddings), and graph memory (entity-relationship triples) with unified cross-layer retrieval
- **Hardware-aware** — auto-detects GPU/VRAM, classifies into three tiers (constrained/balanced/full), and adjusts context budgets, compaction thresholds, and iteration limits accordingly
- **Multi-strategy context compaction** — 6-stage pipeline (tool result clearing, sliding window, code block truncation, regenerate-from-source, LLM summary, emergency trim) keeps long sessions within context limits
- **Conditional tool activation** — tools are enabled/disabled based on runtime context (Ollama reachability, network availability, session mode); keeps the prompt clean for better model reliability
- **Sub-agent orchestration** — spawns isolated verification, research, and planning sub-agents with scoped tools; auto-verification triggers after file edits to catch bugs early; `/verify` and `/research` slash commands for manual control
- **MCP support** — Model Context Protocol client connects to external MCP servers; MCP server exposes Gemma Code's tools to external clients (opt-in, off by default)
- **Windows installer** — a single `setup.exe` installs everything: VS Code extension, Ollama, and the model
- **Privacy-first** — your code and prompts never leave your machine

---

## Prerequisites

| Requirement | Minimum version |
|---|---|
| VS Code | 1.90 |
| Ollama | Latest |
| Node.js (for development) | 20 |

---

## Installation

### Windows / macOS / Linux — PyQt5 installer (recommended, v0.3.0)

1. Download the installer for your platform from the [latest release](https://github.com/bendourthe/Gemma-Code/releases/latest):
   - Windows: `gemma-code-installer.exe`
   - macOS: `GemmaCode.dmg` (Intel or Apple Silicon)
   - Linux: `gemma-code-installer.AppImage`
2. Launch the installer. The wizard will auto-detect your GPU, recommend a model tier, and install:
   - Ollama (if missing)
   - The VS Code extension
   - Optionally, the selected Gemma 4 model
3. Launch VS Code and open the Gemma Code panel from the Activity Bar.

For scripted or CI installs, the installer supports a headless mode:
```bash
python -m gemma_installer.main --headless --skip-model --json-output
```

### Manual — VSIX

1. Download `gemma-code-0.2.0.vsix` from the [latest release](https://github.com/bendourthe/Gemma-Code/releases/latest).
2. In VS Code: **Extensions → ··· → Install from VSIX**.
3. Ensure Ollama is installed and the model is pulled:
   ```bash
   ollama pull gemma4
   ollama serve
   ```

### From source (development)

```bash
git clone https://github.com/bendourthe/Gemma-Code.git
cd Gemma-Code
npm install
npm run build
npx vsce package --no-dependencies
code --install-extension gemma-code-0.2.0.vsix
```

---

## Quick Start

1. Open a project folder in VS Code.
2. Click the Gemma Code icon in the Activity Bar to open the chat panel.
3. Type a task in natural language and press Enter.

**First chat:**
```
Explain the architecture of this codebase and identify the main entry point.
```

**Using /commit:**
```
/commit fix the null-pointer bug in UserService
```

**Enabling plan mode:**
```
/plan
```
The assistant will now produce a numbered plan before making any changes, and wait for your step-by-step approval.

---

## Configuration

All settings are under `gemma-code.*` in VS Code settings (`Ctrl+,`).

| Setting | Default | Description |
|---|---|---|
| `gemma-code.ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `gemma-code.modelName` | `gemma4:e4b` | Model to use for inference |
| `gemma-code.maxTokens` | `131072` | Maximum context tokens (128K for E2B/E4B, 256K for 26B/31B) |
| `gemma-code.temperature` | `1.0` | Sampling temperature (Gemma 4 recommended: 1.0) |
| `gemma-code.topP` | `0.95` | Top-p (nucleus) sampling threshold |
| `gemma-code.topK` | `64` | Top-k sampling threshold |
| `gemma-code.thinkingMode` | `true` | Enable Gemma 4 chain-of-thought reasoning |
| `gemma-code.promptStyle` | `concise` | System prompt verbosity: `concise`, `detailed`, or `beginner` |
| `gemma-code.requestTimeout` | `60000` | HTTP timeout in milliseconds |
| `gemma-code.editMode` | `auto` | How file edits are applied: `auto`, `ask`, or `manual` |
| `gemma-code.toolConfirmationMode` | `ask` | When to ask before running terminal commands: `always`, `ask`, `never` |
| `gemma-code.maxAgentIterations` | `20` | Maximum agentic tool-use iterations per message |
| `gemma-code.memoryEnabled` | `true` | Enable persistent cross-session memory |
| `gemma-code.embeddingModel` | `nomic-embed-text` | Ollama embedding model for semantic memory search (empty string disables) |
| `gemma-code.memoryAutoSaveInterval` | `15` | Messages between automatic memory extraction runs |
| `gemma-code.memoryMaxEntries` | `10000` | Maximum memory entries before automatic pruning |
| `gemma-code.systemPromptBudgetPercent` | `10` | Percentage of context window for system prompt (5-30) |
| `gemma-code.compactionKeepRecent` | `10` | Messages to keep in sliding window during compaction |
| `gemma-code.compactionToolResultsKeep` | `8` | Recent tool results to preserve during compaction |
| `gemma-code.mcpEnabled` | `false` | Enable Model Context Protocol (MCP) support |
| `gemma-code.mcpServerMode` | `off` | MCP server mode: `stdio` (expose tools) or `off` |
| `gemma-code.mcpExposedTools` | `["read_file", "list_directory", "grep_codebase"]` | Allowlist of built-in tools exposed to external MCP clients (read-only subset by default) |
| `gemma-code.permissionOverrides` | `{}` | Per-tool tier override (`0` auto, `1` confirm, `2` dangerous). Tools whose baseline requires confirmation cannot be dropped to `0`; the override is silently clamped to `1` |
| `gemma-code.verificationEnabled` | `true` | Enable auto-verification sub-agent after file edits |
| `gemma-code.verificationThreshold` | `3` | Number of file edits before verification triggers |
| `gemma-code.subAgentMaxIterations` | `10` | Maximum iterations for sub-agent tool loops |

---

## Slash Commands

| Command | Description |
|---|---|
| `/help [command]` | List all commands and skills |
| `/clear` | Clear the current conversation |
| `/history` | Browse and resume past sessions |
| `/plan` | Toggle plan mode on/off |
| `/compact` | Manually trigger context compaction |
| `/model [name]` | Switch the active model |
| `/memory <subcommand>` | Manage persistent memory (search, save, clear, status, lint) |
| `/memory lint [--dry-run\|--apply\|--full\|--limit=N]` | Scan semantic memory for stale, broken-path, embedding-failed, and duplicate entries. Report-only; writes `.gemma-code/memory-health.md`. `--apply` is reserved for future destructive cleanup. |
| `/mcp <subcommand>` | Manage MCP connections (status, connect, disconnect) |
| `/verify` | Manually trigger verification sub-agent on recent changes |
| `/research <query>` | Spawn a research sub-agent to investigate a topic |
| `/commit [args]` | Generate a commit message from staged changes |
| `/review-pr [args]` | Review the current diff or a pull request |
| `/generate-readme` | Create or update README.md |
| `/generate-changelog` | Generate CHANGELOG.md from git history |
| `/generate-tests` | Generate a comprehensive test suite |
| `/analyze-codebase` | Produce a structured codebase analysis |
| `/setup-project` | Bootstrap project structure and configuration |

### Help discovery for the agent

Gemma 4 itself sees the available tools through [src/tools/ToolCatalog.ts](src/tools/ToolCatalog.ts), projected into its system prompt on every turn. The agent uses `get_tool_schema` as its in-extension `--help` analog when it needs to refresh a tool's parameter list mid-task. Users do not invoke `get_tool_schema` directly — the agent does, and the result feeds back into its next reasoning step. See [docs/v0.5.0/tool-audit.md](docs/v0.5.0/tool-audit.md) for the per-tool quality audit.

### Custom skills

Add your own skills to `~/.gemma-code/skills/<name>/SKILL.md`. Gemma Code hot-reloads skills as you add or modify them. See [docs/v0.1.0/tool-protocol.md](docs/v0.1.0/tool-protocol.md) for the SKILL.md format.

---

## Troubleshooting

**"Ollama is not reachable"**
Ensure Ollama is running: `ollama serve`. Gemma Code polls every 5 seconds and reconnects automatically when Ollama comes back online.

**"Model not found"**
Pull the configured model: `ollama pull gemma4`. Use `/model` in the chat to switch to a model you have already pulled.

**Slow responses**
- Use a smaller model variant (e.g. `gemma4:e2b`) via `/model`.
- Increase `gemma-code.requestTimeout` if you are on a slow machine.
- Reduce `gemma-code.maxTokens` to keep context shorter.

**Extension not activating**
Open the Output channel "Gemma Code" (`View → Output`) for diagnostic messages.

**macOS: "cannot be opened because the developer cannot be verified"**
The `.dmg` is not notarized. Right-click the app in `/Applications` and choose **Open** once to accept it, or run `xattr -dr com.apple.quarantine /Applications/GemmaCode.app`.

**Linux: AppImage refuses to launch**
Ensure FUSE is installed (`sudo apt install libfuse2`). If FUSE is unavailable, extract the AppImage and run the embedded binary directly: `./GemmaCode.AppImage --appimage-extract && ./squashfs-root/AppRun`.

---

## Development

```bash
# Install dependencies
npm install

# Build the TypeScript extension
npm run build

# Run unit tests
npm run test

# Run linter
npm run lint

# Run benchmarks
npm run bench

# Package as VSIX
npm run package
```

### Golden task suite (v0.3.0)

Declarative evaluation tasks live under [tests/golden/](tests/golden/). Each task is a YAML file paired with a self-contained git snapshot under [tests/golden/snapshots/](tests/golden/snapshots/).

```bash
# Framework-only tests (no Ollama required)
cd tests/golden && python -m pytest framework/

# Full suite against a running Ollama
OLLAMA_URL=http://localhost:11434 TEST_MODEL=gemma4:e4b \
  python -m pytest -m live_ollama
```

See [docs/v0.3.0/performance-benchmarks.md](docs/v0.3.0/performance-benchmarks.md) for baseline management and regression detection.

---

## Project Structure

```
src/
  extension.ts           Extension entry point
  runtime/               GemmaRuntime composition root (Tracer + settings)
  llm/                   Vendor-neutral LLM port + Ollama adapter (OllamaClient, OllamaHttp)
  chat/                  Conversation manager, streaming, PromptBuilder, compaction, PlanMode
  config/                Settings, PromptBudget token allocation
  panels/                VS Code webview panel and message protocol
  tools/                 Tool registry, agent loop, tool handlers, Gemma 4 format
  agents/                Sub-agent manager (verification, research, planning)
  mcp/                   MCP client, server, and manager
  skills/                Skill loader and built-in skill catalog
  commands/              Slash command router
  storage/               SQLite chat history, MemoryStore, MemorySubsystem factory, EmbeddingClient
  observability/         TraceStore (batched writes), Tracer, MetricsCollector, OTLP exporter
  evaluation/            Golden-task suite (GoldenTaskSuite, YAML cross-check)
  guardrails/            ActionClassifier, GitSafetyNet, LoopDetector, BudgetEnforcer, PermissionTiers, BLOCKED_PATTERNS
  utils/                 Logger, error formatting, Markdown renderer (DOMPurify-sanitized)
tests/
  unit/                  Unit tests (Vitest)
  integration/           Integration tests (Vitest + live Ollama)
  e2e/                   End-to-end tests (Playwright)
  benchmarks/            Performance benchmark suites
docs/
  v0.1.0/               Architecture, tool protocol, CI setup, security audit, benchmarks
  v0.2.0/               Architecture, implementation plan, development history
scripts/
  installer/            NSIS installer script and build helper
.github/
  workflows/            CI (ci.yml), release (release.yml), nightly (nightly.yml)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| VS Code Extension | TypeScript + Vitest |
| Local Model | Google Gemma (via Ollama, direct HTTP) |
| Persistence | SQLite (better-sqlite3) with FTS5 |
| Installer | PyQt5 cross-platform wizard |
| CI/CD | GitHub Actions |

---

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for the project tour, conventions, daily loop, and the one-command dev-setup scripts ([scripts/dev-setup.sh](scripts/dev-setup.sh) on macOS/Linux, [scripts/dev-setup.ps1](scripts/dev-setup.ps1) on Windows).

**Commit convention:** conventional commits (`feat:`, `fix:`, `chore:`, etc.); ASCII-only.
**CI:** all PRs must pass `lint-ts` and `test-ts` with coverage ≥ 80%.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
