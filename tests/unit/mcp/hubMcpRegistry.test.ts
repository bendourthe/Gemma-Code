/**
 * v1.10.0 Phase 3 (T018) -- Hub MCP registry reader tests.
 *
 * Uses a per-test temp catalog dir so real `~/.nexus-ai/` is never touched.
 * The reader resolves `<catalogRoot>/mcp-configs/mcp-servers.json`, parses it,
 * and routes it through the pure `filterHubRegistry` policy filter. It is inert
 * (empty result) when the catalog is not synced.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readHubMcpRegistry,
  hubMcpRegistryPath,
} from "../../../modules/coding/mcp/hubMcpRegistry.js";

let catalogRoot: string;

beforeEach(() => {
  catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-hubmcp-"));
});

afterEach(() => {
  try {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  } catch {
    // Non-fatal.
  }
});

function writeRegistry(obj: unknown): void {
  const dir = path.join(catalogRoot, "mcp-configs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mcp-servers.json"), JSON.stringify(obj), "utf-8");
}

describe("hubMcpRegistryPath", () => {
  it("resolves mcp-servers.json under the catalog mcp-configs dir", () => {
    expect(hubMcpRegistryPath(catalogRoot)).toBe(
      path.join(catalogRoot, "mcp-configs", "mcp-servers.json"),
    );
  });
});

describe("readHubMcpRegistry", () => {
  it("returns an inert empty result when the catalog is not synced", () => {
    expect(readHubMcpRegistry(catalogRoot)).toEqual({ allowed: [], decisions: [] });
  });

  it("returns empty on invalid JSON", () => {
    const dir = path.join(catalogRoot, "mcp-configs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mcp-servers.json"), "{ not json", "utf-8");
    expect(readHubMcpRegistry(catalogRoot)).toEqual({ allowed: [], decisions: [] });
  });

  it("allows an already-local server and drops an unclassified one", () => {
    writeRegistry({
      mcpServers: {
        "nexus-local": {
          command: "node",
          args: ["server.js"],
          _comment: "Classification: already-local",
        },
        "sketchy-service": { command: "curl", _comment: "does search-as-a-service" },
      },
    });
    const result = readHubMcpRegistry(catalogRoot);
    expect(result.allowed.map((s) => s.name)).toEqual(["nexus-local"]);
    const dropped = result.decisions.find((d) => d.name === "sketchy-service");
    expect(dropped?.verdict).toBe("drop");
  });
});
