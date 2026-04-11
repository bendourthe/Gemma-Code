# Architecture

> High-level overview of Gemma Code's architecture. For the full document with data flow diagrams and component details, see [docs/v0.2.0/architecture.md](docs/v0.2.0/architecture.md).

## Three-Process Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  VS Code                                                                │
│                                                                         │
│  ┌──────────────────────────────────┐  postMessage  ┌────────────────┐ │
│  │  Extension Host (Node.js)        │ ◄────────────► │  Webview       │ │
│  │                                  │                │  (HTML/CSS/JS) │ │
│  │  Core:                           │                └────────────────┘ │
│  │    GemmaCodePanel                │                                   │
│  │    ConversationManager           │                                   │
│  │    StreamingPipeline             │                                   │
│  │    AgentLoop + ToolRegistry      │                                   │
│  │    ChatHistoryStore (SQLite)     │                                   │
│  │                                  │                                   │
│  │  v0.2.0:                         │                                   │
│  │    PromptBuilder + PromptBudget  │    ┌──────────────────────┐      │
│  │    CompactionPipeline            │    │  External MCP        │      │
│  │    MemoryStore + EmbeddingClient │◄──►│  Servers (optional)  │      │
│  │    SubAgentManager               │    └──────────────────────┘      │
│  │    McpManager                    │                                   │
│  │    ToolActivationRules           │                                   │
│  └──────────────┬───────────────────┘                                  │
│                 │ HTTP (SSE / REST)                                      │
└─────────────────┼──────────────────────────────────────────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
       v                     v
┌──────────────┐    ┌─────────────────────────┐
│  Python      │    │  Ollama                  │
│  FastAPI     │───>│  (local model runtime)   │
│  Backend     │    │  gemma4:e4b              │
│  :11435      │    │  :11434                  │
└──────────────┘    └─────────────────────────┘
```

All inference runs locally. No data leaves the developer's machine.

## Key Components

### Core (v0.1.0)

| Component | File | Purpose |
|-----------|------|---------|
| OllamaClient | `src/ollama/client.ts` | HTTP client for Ollama REST API |
| ConversationManager | `src/chat/ConversationManager.ts` | Message history and system prompt management |
| StreamingPipeline | `src/chat/StreamingPipeline.ts` | Streaming token relay to webview |
| AgentLoop | `src/tools/AgentLoop.ts` | Multi-turn tool execution loop |
| ToolRegistry | `src/tools/ToolRegistry.ts` | Tool name-to-handler dispatch |
| GemmaCodePanel | `src/panels/GemmaCodePanel.ts` | Webview chat UI provider and orchestrator |
| ChatHistoryStore | `src/storage/ChatHistoryStore.ts` | SQLite session persistence with FTS5 search |
| BackendManager | `src/backend/BackendManager.ts` | Python process lifecycle management |

### v0.2.0 Additions

| Component | File | Purpose |
|-----------|------|---------|
| Gemma4ToolFormat | `src/tools/Gemma4ToolFormat.ts` | Native `<\|tool_call>` / `<\|tool_result>` protocol |
| PromptBuilder | `src/chat/PromptBuilder.ts` | Dynamic system prompt assembly with token budgeting |
| PromptBudget | `src/config/PromptBudget.ts` | Token budget allocation calculator |
| CompactionPipeline | `src/chat/CompactionStrategy.ts` | 5-strategy context compaction (cheapest first) |
| MemoryStore | `src/storage/MemoryStore.ts` | Persistent cross-session memory (SQLite FTS5 + embeddings) |
| EmbeddingClient | `src/storage/EmbeddingClient.ts` | Ollama embedding interface for semantic search |
| ToolActivationRules | `src/tools/ToolActivationRules.ts` | Context-dependent tool enable/disable with 15-tool cap |
| McpManager | `src/mcp/McpManager.ts` | MCP client/server lifecycle and configuration |
| SubAgentManager | `src/agents/SubAgentManager.ts` | Verification, research, and planning sub-agents |

## Token Budget Allocation

| Section | Budget | Purpose |
|---------|--------|---------|
| System prompt | 10% | Base instructions + tool declarations |
| Memory injection | 3% | Cross-session memory context |
| Skill injection | 2% | Active skill descriptions |
| Conversation | 65% | Message history (compaction target) |
| Response reserve | 20% | Model reply generation |

## Tool Protocol

v0.2.0 uses Gemma 4 native tokens for tool interaction:

- Tool declarations: `<|tool>...<tool|>`
- Tool calls: `<|tool_call>...<tool_call|>`
- Tool results: `<|tool_result>...<tool_result|>`

This replaces the v0.1.0 custom XML protocol. See [docs/v0.1.0/tool-protocol.md](docs/v0.1.0/tool-protocol.md) for legacy reference.

## Further Reading

- [Full Architecture (v0.2.0)](docs/v0.2.0/architecture.md) -- comprehensive component descriptions and data flow diagrams
- [Architecture (v0.1.0)](docs/v0.1.0/architecture.md) -- original architecture document
- [Tool Protocol (v0.1.0)](docs/v0.1.0/tool-protocol.md) -- legacy XML tool protocol specification
- [Security Audit](docs/v0.1.0/security-audit.md) -- security findings and remediations
- [Implementation Plan](docs/v0.2.0/development/implementation-plan.md) -- v0.2.0 phase breakdown
