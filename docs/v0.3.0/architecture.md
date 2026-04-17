# Architecture -- Gemma Code v0.3.0

## Overview

v0.3.0 builds on the v0.2.0 foundation and adds: hardware-aware GPU tier detection, context engineering improvements, graph-vector hybrid memory, safety and budget controls, plan-and-execute orchestration, local observability with a trace dashboard, a cross-platform PyQt5 installer, and a golden-task evaluation suite.

The four-component runtime ecosystem:

1. **TypeScript extension** -- VS Code Extension Host (Node.js).
2. **Python FastAPI backend** -- child process spawned on activation (port 11435).
3. **Ollama server** -- local model runtime (port 11434).
4. **PyQt5 installer** (new in v0.3.0) -- standalone cross-platform wizard that bootstraps the above.

---

## System architecture (v0.3.0)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  User machine                                                                │
│                                                                              │
│  ┌────────────────┐     (one-shot install)                                   │
│  │ PyQt5          │──► VS Code extension + Python venv + Ollama + model      │
│  │ Installer      │                                                          │
│  └────────────────┘                                                          │
│                                                                              │
│  ┌─────────────────────────────────────┐   postMessage  ┌──────────────────┐ │
│  │  VS Code Extension Host (Node.js)   │◄──────────────►│  Chat webview    │ │
│  │                                     │                │                  │ │
│  │  extension.ts                       │                │  Badges: PLAN,   │ │
│  │  PromptBuilder + PromptBudget       │                │  THINK, MEM, MCP │ │
│  │  ConversationManager                │                │                  │ │
│  │  AgentLoop + ToolRegistry           │                │  Trace dashboard │ │
│  │  ToolActivationRules (15-cap)       │                │  side panel      │ │
│  │  Gemma4ToolFormat                   │                └──────────────────┘ │
│  │  CompactionPipeline (5 strategies)  │                                     │
│  │  MemoryStore (SQLite FTS5 + embed)  │                                     │
│  │  GraphMemory + GraphQueryEngine     │      ┌─────────────────────────┐    │
│  │  UnifiedMemoryRetriever             │      │  External MCP servers   │    │
│  │  SubAgentManager                    │ ◄──► │  (optional)             │    │
│  │  McpManager                         │      └─────────────────────────┘    │
│  │  Tracer (OTEL-compatible spans)     │                                     │
│  │  BudgetMiddleware + SafetyGuards    │                                     │
│  │  ChatHistoryStore (SQLite FTS5)     │                                     │
│  │  BackendManager                     │                                     │
│  └───────────┬─────────────────────────┘                                     │
│              │ HTTP (SSE / REST)                                             │
└──────────────┼──────────────────────────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    v                     v
┌───────────────┐   ┌───────────────────────────────┐
│  Python       │   │  Ollama                       │
│  FastAPI      │──►│  gemma4:{e2b,e4b,26b,31b}     │
│  backend      │   │  :11434                       │
│  :11435       │   └───────────────────────────────┘
└───────────────┘
```

---

## Component table

v0.2.0 components (unchanged) plus v0.3.0 additions:

| Component | Purpose | v0.3.0 change |
| --- | --- | --- |
| `PromptBuilder` | Dynamic system-prompt assembly within token budget | Hardware-tier aware budget |
| `ConversationManager` | In-memory message history + persistence | Unchanged |
| `CompactionPipeline` | 5-strategy context compaction | `LazyToolLoader` integration |
| `MemoryStore` | SQLite FTS5 + optional embeddings | 4-layer memory (working/episodic/semantic/graph) |
| `GraphMemory` / `GraphQueryEngine` (new) | Entity-relation graph over code artifacts | New in v0.3.0 |
| `UnifiedMemoryRetriever` (new) | Fan-out retrieval across all memory layers | New in v0.3.0 |
| `SubAgentManager` | Verification/research/planning sub-agents | Now plan-and-execute orchestration aware |
| `McpManager` | External MCP server connector | Unchanged |
| `Tracer` (new) | OTEL-compatible span tracing + local dashboard | New in v0.3.0 |
| `BudgetMiddleware` (new) | Token, time, and iteration budgets | New in v0.3.0 |
| `LazyToolLoader` (new) | On-demand tool metadata loading | New in v0.3.0 |
| `InstallEngine` (new) | Orchestrates platform-specific install steps | New in v0.3.0 (PyQt5) |
| `GoldenTaskRunner` (new) | Loads, runs, and evaluates declarative golden tasks | New in v0.3.0 |
| `RegressionDetector` (new) | Baseline comparison across versions | New in v0.3.0 |

---

## Installer architecture (new in v0.3.0)

The installer lives at [scripts/installer/pyqt/](../../scripts/installer/pyqt/) and replaces the Windows-only NSIS installer. It is a PyQt5 wizard with 9 pages plus an `InstallEngine` that performs each install step in a background thread:

```
Welcome -> Prerequisites -> GPU Detection -> Install Path -> Model Selection
  -> Configuration -> Review -> Installing -> Complete
```

The `InstallEngine` orchestrates four platform-agnostic installers (code lives under `scripts/installer/pyqt/src/gemma_installer/engine/`):

- `OllamaInstaller`: auto-detects and installs Ollama (winget / brew / curl).
- `ExtensionInstaller`: invokes `code --install-extension` with the bundled VSIX.
- `VenvInstaller`: creates a Python 3.11+ venv and installs the FastAPI backend.
- `ModelPuller`: streams `ollama pull` with progress reporting.

### Headless mode (new in Phase 8)

The installer exposes a headless CLI for CI smoke tests. See [tests/smoke/](../../tests/smoke/):

```bash
python -m gemma_installer.main \
  --headless --install-path /tmp/gemma-test --model gemma4:e2b \
  --skip-model --json-output
```

### Platform detection and GPU classification

```
             ┌───────────────────────┐
  Windows ──►│ WMI + nvidia-smi      │──► VRAM MB  ──► Tier 1/2/3
  macOS   ──►│ system_profiler       │──►           ──►
  Linux   ──►│ nvidia-smi + lspci    │──►           ──►
             └───────────────────────┘
```

---

## Quality-assurance architecture (new in v0.3.0)

### Golden task execution flow

```
YAML task ──► task_loader ──► task_runner ──► snapshot.prepare_worktree
                                                │
                                                ▼
                                     AgentLoop (live Ollama)
                                                │
                                                ▼
                                     evaluator.evaluate(criteria)
                                                │
                                                ▼
                                     reporter -> JSON + Markdown
```

### Benchmark pipeline

```
model-tier-matrix.bench.ts ──► Vitest ──► per-tier thresholds
memory-recall.bench.ts     ──► Vitest ──► recall + latency
golden-task-perf.bench.ts  ──► Vitest ──► Python subprocess ──► TaskResult
                                                                     │
                                                                     ▼
                                                       baseline.save_baseline
```

### Regression detection flow

```
current run ──┐
              ├──► detect_regressions(thresholds) ──► generate_regression_report
baseline    ──┘                                         │
                                                        ▼
                                              Markdown / CI issue
```

---

## Token budget allocation

| Section | Priority | Default share of 128K context |
| --- | --- | --- |
| Base instructions | 1 (always) | ~1.5K tokens |
| Tool declarations (built-ins + active MCP) | 2 (always) | ~3K tokens |
| Gemma 4 tool protocol hints | 3 | ~0.5K tokens |
| Memory context (when populated) | 4 | up to ~5K tokens |
| Skill context (active skill) | 5 | up to ~2K tokens |
| Plan mode section | 6 | ~0.5K tokens |
| Thinking mode section | 7 | ~0.3K tokens |

Tiers: E2B/E4B (128K) -> 10% budget -> ~13K tokens; 26B/31B (256K) -> 10% -> ~26K tokens.

---

## Cross-platform support matrix

| Component | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Installer binary | PyInstaller `.exe` | PyInstaller `.app` / `.dmg` | PyInstaller / AppImage |
| GPU detection | `nvidia-smi`, WMI | `system_profiler` | `nvidia-smi`, `lspci` |
| Ollama installer | `winget install Ollama.Ollama` | `brew install ollama` | `curl https://ollama.com/install.sh \| sh` |
| Python venv | `python -m venv` | `python3 -m venv` | `python3 -m venv` |
| VS Code CLI | `code` | `code` (from Applications) | `code` |
| Smoke test script | `tests/smoke/smoke-windows.ps1` | `tests/smoke/smoke-macos.sh` | `tests/smoke/smoke-linux.sh` |

---

## Further reading

- [v0.3.0 implementation plan](implementation-plan.md)
- [Performance benchmarks](performance-benchmarks.md)
- [Performance comparison](performance-comparison.md)
- [Release checklist](release-checklist.md)
- [CI pipeline](ci-pipeline.md)
- [v0.2.0 architecture](../v0.2.0/architecture.md) for the prior-generation design
