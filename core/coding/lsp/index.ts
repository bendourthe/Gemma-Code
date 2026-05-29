/**
 * v1.2.0 Phase 6.2 -- LSP module barrel.
 */

export {
  LspClient,
  DefaultLspLauncher,
  DEFAULT_LSP_SERVERS,
  type LspClientOptions,
  type LspChildProcessLauncher,
  type LspDefinitionRequest,
  type LspLanguage,
  type LspLocation,
  type LspPosition,
  type LspReferencesRequest,
  type LspResult,
  type LspServerConfig,
} from "./LspClient.js";

export {
  LspMcpServer,
  LSP_MCP_SERVER_ID,
  LSP_TOOL_NAMES,
  type LspMcpServerOptions,
  type LspToolName,
} from "./LspMcpServer.js";
