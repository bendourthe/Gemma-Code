# Phase 4: Conditional Tool Activation and MCP Support

**Date:** 2026-04-09
**Plan:** `docs/v0.2.0/development/implementation-plan.md`, Phase 4
**Status:** Complete

---

## Objective

Make tool availability context-dependent (fewer tools = cleaner prompt) and add Model Context Protocol (MCP) support for interoperability with the broader AI tooling ecosystem.

## Implementation Steps

### Subtask 1: Type System Extensions
- Split `ToolName` into `BuiltinToolName | McpToolName` with `mcp:` prefix namespace
- Added `DynamicToolMetadata` extending `ToolMetadata` with `source` and `priority` fields
- Updated `isToolName()` in Gemma4ToolFormat to accept `mcp:` prefixed names
- Widened `PromptContext.enabledTools` to accept `DynamicToolMetadata`

### Subtask 2: ToolRegistry Enable/Disable
- Added `_enabled` Map alongside `_handlers` in ToolRegistry
- New methods: `setEnabled()`, `isEnabled()`, `getEnabledNames()`, `getEnabledToolMetadata()`
- `execute()` now returns "currently disabled" error for disabled tools
- Newly registered tools default to enabled

### Subtask 3: Tool Activation Rules Engine
- Created `ToolActivationRules.ts` as a pure function `computeToolActivation()`
- 6 rules: Ollama reachable, network available, read-only session, sub-agent type (research/verification), 15-tool cap
- Each rule produces a reason string for debugging
- Rules compose: a tool disabled by an earlier rule stays disabled

### Subtask 4: GemmaCodePanel Wiring
- Stored `_registry` as instance field (was local variable)
- Added `_ollamaReachable` state with `setOllamaReachable()` public method
- `_getEnabledToolMetadata()` combines static catalog + MCP tools, runs rules, syncs registry state
- Wired `setOllamaReachable()` into extension.ts health poller
- **Issue:** Constructor calls `_buildPromptContext()` before `_registry` is assigned. Fixed with guard: `if (!this._registry) return builtinTools`

### Subtask 5: Settings, Commands, Types
- Added `mcpEnabled` (default false) and `mcpServerMode` ("off") to settings
- Added `/mcp` to CommandRouter with status/connect/disconnect subcommands
- Created `src/mcp/McpTypes.ts` with McpServerConfig, McpToolInfo, McpServerState interfaces

### Subtask 6: MCP SDK + McpClient
- Installed `@modelcontextprotocol/sdk` (v1.29.0)
- **Issue:** ESM/CJS interop. SDK is ESM-only; project uses Node16 module resolution. Solution: all SDK imports via dynamic `import()`.
- Created `McpClient.ts`: connects via StdioClientTransport, discovers tools, delegates callTool via JSON-RPC
- Created `McpToolHandler.ts`: ToolHandler wrapper delegating to McpClient

### Subtask 7: McpManager
- Created `McpManager.ts`: reads config from `.gemma-code/mcp.json` (workspace overrides global)
- Manages multiple McpClient instances by server name
- On connect: discovers tools, registers in ToolRegistry via McpToolHandler
- On disconnect: disables tools, disconnects client

### Subtask 8: McpServer + Final Wiring
- Created `McpServer.ts`: exposes built-in tools via MCP stdio transport
- **Issue:** `McpServer` class is at `server/mcp.js`, not re-exported from `server/index`. Fixed import path.
- **Issue:** `server.tool()` 4-arg overload expects Zod schema. Used 3-arg overload (name, description, callback) instead.
- Wired McpManager and McpServer into GemmaCodePanel constructor (lazy init based on settings)
- `/mcp` command handler uses real McpManager for connect/disconnect/status
- Added MCP cleanup to `dispose()`

## Test Results

- **Before:** 372 tests passing
- **After:** 416 tests passing (+44 new)
- **New test files:** ToolActivationRules (10 tests), McpClient (10 tests), McpManager (9 tests), McpServer (6 tests)
- **Updated test files:** ToolRegistry (+7 tests), CommandRouter (+2 tests), settings (+2 tests)
- **Build:** Clean (0 TypeScript errors)
- **Lint:** Clean (0 ESLint errors)

## Files Created

| File | Purpose |
|------|---------|
| `src/tools/ToolActivationRules.ts` | Pure function: context-dependent tool disable rules |
| `src/mcp/McpTypes.ts` | MCP type definitions |
| `src/mcp/McpClient.ts` | Connect to external MCP servers |
| `src/mcp/McpToolHandler.ts` | ToolHandler wrapper for MCP calls |
| `src/mcp/McpManager.ts` | MCP lifecycle and config management |
| `src/mcp/McpServer.ts` | Expose built-in tools via MCP |

## Files Modified

| File | Change |
|------|--------|
| `src/tools/types.ts` | BuiltinToolName + McpToolName union |
| `src/tools/ToolCatalog.ts` | DynamicToolMetadata, toDynamicMetadata |
| `src/tools/Gemma4ToolFormat.ts` | Accept mcp: prefix in isToolName |
| `src/tools/ToolRegistry.ts` | Enable/disable state |
| `src/chat/PromptBuilder.types.ts` | Widen enabledTools type |
| `src/config/settings.ts` | mcpEnabled, mcpServerMode |
| `src/commands/CommandRouter.ts` | /mcp command |
| `src/panels/GemmaCodePanel.ts` | Tool activation wiring, MCP lifecycle |
| `src/extension.ts` | setOllamaReachable in health poller |
| `package.json` | @modelcontextprotocol/sdk dependency, MCP settings |

## Key Decisions

1. **`mcp:` prefix over `(string & {})`**: Preserves runtime type narrowing and prevents collision
2. **Dynamic imports for MCP SDK**: Avoids ESM/CJS interop issues without changing build config
3. **Pure function for rules engine**: `computeToolActivation()` is trivially testable in isolation
4. **Lazy MCP initialization**: Zero overhead when `mcpEnabled: false` (the default)

## Next Phase

Phase 5: Sub-Agent Orchestration (verification, research, planning sub-agents)
