# Gemma Code

> A local, agentic coding assistant for VS Code powered by Google's Gemma 4 — no API keys, no data leaving your machine.

Gemma Code brings a [Claude Code](https://claude.ai/claude-code)-style agentic workflow to VS Code, running entirely on your local hardware via [Ollama](https://ollama.com). It can read and edit files across your codebase, execute terminal commands, reason across multiple files simultaneously, and plan multi-step coding tasks — all without a network connection or a cloud subscription.

---

## Features

- **Fully offline** — all inference runs locally via Ollama; no data is sent to external servers
- **Agentic workflow** — the assistant can plan, edit, run commands, and iterate autonomously across multiple steps
- **Codebase-wide reasoning** — reads and understands multiple files simultaneously to make context-aware edits
- **Terminal execution** — can run shell commands and interpret their output as part of a task
- **No API key required** — just install the extension, pull the model, and start coding
- **Privacy-first** — your code and prompts never leave your machine

---

## Prerequisites

Before installing Gemma Code, ensure the following are set up:

1. **VS Code** 1.85 or later
2. **Ollama** installed and running ([install guide](https://ollama.com/download))
3. **Gemma 4 model** pulled locally:
   ```bash
   ollama pull gemma4
   ```
4. Ollama server running:
   ```bash
   ollama serve
   ```

---

## Installation

> The extension is not yet published. Installation instructions will be added once the first release is available.

To build and install from source (development):

```bash
# Clone the repository
git clone https://github.com/bendourthe/Gemma-Code.git
cd Gemma-Code

# Install dependencies
npm install

# Build the extension
npm run build

# Package and install (requires vsce)
npx vsce package
code --install-extension gemma-code-*.vsix
```

---

## Usage

Once installed and Ollama is running with the Gemma 4 model:

1. Open a project folder in VS Code
2. Open the Gemma Code panel from the Activity Bar
3. Describe a coding task in natural language
4. The assistant will propose a plan, make edits, and run commands with your confirmation

More detailed usage documentation will be added as features are implemented.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| VS Code Extension | TypeScript |
| Inference Backend | Python + Ollama REST API |
| Performance Components | Rust |
| CLI / Tooling | Go |
| Local Model | Google Gemma 4 (via Ollama) |

---

## Project Structure

```
src/         VS Code extension source (TypeScript)
lib/         Shared utilities across components
tests/       Unit, integration, and e2e tests
docs/        Architecture docs and guides
configs/     Linter, launch, and environment configs
scripts/     Build and utility scripts
assets/      Icons and static assets
examples/    Demo workflows and sample usage
```

---

## Development

```bash
# TypeScript extension
npm run build
npm run test

# Python backend
uv run pytest
uv run ruff check . && uv run ruff format .

# Rust components
cargo build && cargo test && cargo clippy

# Go tooling
go build ./... && go test -race ./...
```

---

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a pull request. See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines (coming soon).

---

## License

MIT License. See [LICENSE](LICENSE) for details.
