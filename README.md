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
- **Cross-session memory** — automatically extracts decisions, facts, and patterns from conversations; retrieves relevant memories in future sessions using FTS5 keyword search and optional Ollama embeddings
- **Multi-strategy context compaction** — 5-stage pipeline (tool result clearing, sliding window, code block truncation, LLM summary, emergency trim) keeps long sessions within context limits
- **Conditional tool activation** — tools are enabled/disabled based on runtime context (Ollama reachability, network availability, session mode); keeps the prompt clean for better model reliability
- **Sub-agent orchestration** — spawns isolated verification, research, and planning sub-agents with scoped tools; auto-verification triggers after file edits to catch bugs early; `/verify` and `/research` slash commands for manual control
- **MCP support** — Model Context Protocol client connects to external MCP servers; MCP server exposes Gemma Code's tools to external clients (opt-in, off by default)
- **Python inference backend** — optional FastAPI backend applies the Gemma chat template for higher-quality results
- **Windows installer** — a single `setup.exe` installs everything: VS Code extension, Ollama, and the model
- **Privacy-first** — your code and prompts never leave your machine

---

## Prerequisites

| Requirement | Minimum version |
|---|---|
| VS Code | 1.90 |
| Ollama | Latest |
| Python (for backend) | 3.11 |
| Node.js (for development) | 20 |

---

## Installation

### Windows — Installer (recommended)

1. Download `setup.exe` from the [latest release](https://github.com/bendourthe/Gemma-Code/releases/latest).
2. Run the installer. It will:
   - Install Ollama if not already present
   - Install the VS Code extension
   - Set up the Python inference backend
   - Optionally download the Gemma model (~9.6 GB)
3. Launch VS Code and open the Gemma Code panel from the Activity Bar.

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
| `gemma-code.useBackend` | `true` | Route inference through the Python backend for better prompt formatting |
| `gemma-code.backendPort` | `11435` | Local Python backend port |
| `gemma-code.pythonPath` | `python` | Python executable path |
| `gemma-code.memoryEnabled` | `true` | Enable persistent cross-session memory |
| `gemma-code.embeddingModel` | `nomic-embed-text` | Ollama embedding model for semantic memory search (empty string disables) |
| `gemma-code.memoryAutoSaveInterval` | `15` | Messages between automatic memory extraction runs |
| `gemma-code.memoryMaxEntries` | `10000` | Maximum memory entries before automatic pruning |
| `gemma-code.systemPromptBudgetPercent` | `10` | Percentage of context window for system prompt (5-30) |
| `gemma-code.compactionKeepRecent` | `10` | Messages to keep in sliding window during compaction |
| `gemma-code.compactionToolResultsKeep` | `8` | Recent tool results to preserve during compaction |
| `gemma-code.mcpEnabled` | `false` | Enable Model Context Protocol (MCP) support |
| `gemma-code.mcpServerMode` | `off` | MCP server mode: `stdio` (expose tools) or `off` |
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
| `/memory <subcommand>` | Manage persistent memory (search, save, clear, status) |
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

### Custom skills

Add your own skills to `~/.gemma-code/skills/<name>/SKILL.md`. Gemma Code hot-reloads skills as you add or modify them. See [docs/v0.1.0/tool-protocol.md](docs/v0.1.0/tool-protocol.md) for the SKILL.md format.

---

## Troubleshooting

**"Ollama is not reachable"**
Ensure Ollama is running: `ollama serve`. Gemma Code polls every 5 seconds and reconnects automatically when Ollama comes back online.

**"Model not found"**
Pull the configured model: `ollama pull gemma4`. Use `/model` in the chat to switch to a model you have already pulled.

**"Backend process exited; using direct Ollama mode"**
The Python backend failed to start. Check the "Gemma Code" Output channel for the error. Common causes: Python not found, missing packages, or port 11435 in use. Set `gemma-code.useBackend` to `false` to disable the backend and use Ollama directly.

**Slow responses**
- Use a smaller model variant (e.g. `gemma4:e2b`) via `/model`.
- Increase `gemma-code.requestTimeout` if you are on a slow machine.
- Reduce `gemma-code.maxTokens` to keep context shorter.

**Extension not activating**
Open the Output channel "Gemma Code" (`View → Output`) for diagnostic messages.

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

```bash
# Python backend (from src/backend/)
uv run pytest tests/unit tests/integration -q
uv run ruff check . && uv run ruff format .
```

---

## Project Structure

```
src/
  extension.ts           Extension entry point
  ollama/                Ollama HTTP client
  chat/                  Conversation manager, streaming, PromptBuilder, compaction
  config/                Settings, PromptBudget token allocation
  panels/                VS Code webview panel and message protocol
  tools/                 Tool registry, agent loop, tool handlers, Gemma 4 format
  agents/                Sub-agent manager (verification, research, planning)
  mcp/                   MCP client, server, and manager
  skills/                Skill loader and built-in skill catalog
  commands/              Slash command router
  modes/                 Plan mode and edit mode
  storage/               SQLite chat history, MemoryStore, EmbeddingClient
  utils/                 Markdown renderer
  backend/               Python FastAPI inference backend (separate package)
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
| Inference Backend | Python + FastAPI + Ollama |
| Local Model | Google Gemma (via Ollama) |
| Persistence | SQLite (better-sqlite3) |
| Installer | NSIS (Windows) |
| CI/CD | GitHub Actions |

---

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a pull request.

**Development setup:** see the Development section above.
**Commit convention:** conventional commits (`feat:`, `fix:`, `chore:`, etc.).
**CI:** all PRs must pass `lint-ts`, `test-ts`, `lint-py`, and `test-py` with coverage ≥ 80%.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
