/**
 * v1.2.0 Phase 3 -- MCP re-exports.
 *
 * `CodeGraphMcpServer` implements `McpHarnessAdapter` from
 * `core/coding/McpBridge.ts` so the 8 `codegraph_*` tools become invokable
 * via the same in-process pipeline the daemon's MCP harness uses. The server
 * deliberately does not bind a network port -- it runs inside the Node
 * sidecar process per the Phase 3.4 acceptance criteria.
 */

export {
  CodeGraphMcpServer,
  CODEGRAPH_MCP_SERVER_ID,
  type CodeGraphMcpServerOptions,
} from "./CodeGraphMcpServer.js";
