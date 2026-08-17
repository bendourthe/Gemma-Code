/**
 * v1.18.0 Phase 3 (OW-A5) -- filesystem helpers for `.nexus/mcp-tool-deny.json`.
 *
 * vscode-free. McpManager and the sidecar MCP registry settings surface share
 * this store so a toggle in Settings is the same file the agent loop reads.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  MCP_TOOL_DENY_FILENAME,
  emptyMcpToolDenyFile,
  parseMcpToolDenyFile,
  type McpToolDenyFile,
} from "./McpToolDeny.js";

export function mcpToolDenyPath(workspacePath: string): string {
  return path.join(workspacePath, ".nexus", MCP_TOOL_DENY_FILENAME);
}

export function readMcpToolDenyFile(workspacePath: string): McpToolDenyFile {
  const filePath = mcpToolDenyPath(workspacePath);
  try {
    if (!fs.existsSync(filePath)) return emptyMcpToolDenyFile();
    const raw = fs.readFileSync(filePath, "utf-8");
    return parseMcpToolDenyFile(JSON.parse(raw) as unknown);
  } catch {
    return emptyMcpToolDenyFile();
  }
}

export function writeMcpToolDenyFile(workspacePath: string, file: McpToolDenyFile): void {
  const filePath = mcpToolDenyPath(workspacePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}
