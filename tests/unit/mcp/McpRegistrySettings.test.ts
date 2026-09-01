import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { writeMcpToolDenyFile } from "../../../modules/coding/mcp/McpToolDenyStore.js";
import {
  listMcpRegistrySettings,
  setMcpRegistryToolDenied,
} from "../../../modules/coding/mcp/McpRegistrySettings.js";
import type { HubRegistryFilterResult } from "../../../modules/coding/mcp/HubRegistryPolicyFilter.js";

const HUB: HubRegistryFilterResult = {
  allowed: [{ name: "nexus-skill-server", command: "python", transport: "stdio" }],
  decisions: [
    {
      name: "nexus-skill-server",
      classification: "already-local",
      verdict: "allow",
      reason: "classification 'already-local' is consumable",
    },
    {
      name: "exa-web-search",
      classification: "drop-outright",
      verdict: "drop",
      reason: "classification 'drop-outright' is not consumable per the MCP Registry Policy",
    },
  ],
};

describe("McpRegistrySettings (v1.18.0 Phase 3 OW-A5)", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-mcp-reg-"));
    writeMcpToolDenyFile(root, {
      version: 1,
      servers: {
        "nexus-skill-server": { deniedTools: [], knownTools: ["list_skills"] },
        "exa-web-search": { deniedTools: [], knownTools: ["search"] },
      },
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("lists hub allow/drop and will not enable a policy-denied tool", () => {
    const listed = listMcpRegistrySettings({
      workspacePath: root,
      hub: HUB,
      userServers: [],
    });
    const allowed = listed.servers.find((s) => s.name === "nexus-skill-server");
    const dropped = listed.servers.find((s) => s.name === "exa-web-search");
    expect(allowed?.policyVerdict).toBe("allow");
    expect(allowed?.tools[0]?.toggleable).toBe(true);
    expect(dropped?.policyVerdict).toBe("drop");
    expect(dropped?.tools[0]?.exposed).toBe(false);
    expect(dropped?.tools[0]?.toggleable).toBe(false);

    const enableDropped = setMcpRegistryToolDenied({
      workspacePath: root,
      serverName: "exa-web-search",
      toolName: "search",
      denied: false,
      hub: HUB,
      userServers: [],
    });
    expect(enableDropped.ok).toBe(false);
    const after = enableDropped.list.servers.find((s) => s.name === "exa-web-search");
    expect(after?.tools[0]?.exposed).toBe(false);
  });

  it("user deny removes a tool from the allowed server", () => {
    const result = setMcpRegistryToolDenied({
      workspacePath: root,
      serverName: "nexus-skill-server",
      toolName: "list_skills",
      denied: true,
      hub: HUB,
      userServers: [],
    });
    expect(result.ok).toBe(true);
    const server = result.list.servers.find((s) => s.name === "nexus-skill-server");
    expect(server?.tools.find((t) => t.name === "list_skills")?.exposed).toBe(false);
    expect(server?.tools.find((t) => t.name === "list_skills")?.reason).toBe("user-denied");
  });

  it("merges server registrations and denials across selected roots", async () => {
    const second = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-mcp-reg-second-"));
    try {
      await fs.mkdir(path.join(second, ".nexus"), { recursive: true });
      await fs.writeFile(
        path.join(second, ".nexus", "mcp.json"),
        JSON.stringify({ servers: [{ name: "secondary-server" }] }),
      );
      writeMcpToolDenyFile(second, {
        version: 1,
        servers: { "nexus-skill-server": { deniedTools: ["list_skills"], knownTools: ["list_skills"] } },
      });
      const listed = listMcpRegistrySettings({
        workspacePath: root,
        workspaceRoots: [root, second],
        hub: HUB,
      });
      expect(listed.servers.some((server) => server.name === "secondary-server")).toBe(true);
      expect(listed.servers.find((server) => server.name === "nexus-skill-server")?.tools[0]?.reason)
        .toBe("user-denied");
    } finally {
      await fs.rm(second, { recursive: true, force: true });
    }
  });
});
