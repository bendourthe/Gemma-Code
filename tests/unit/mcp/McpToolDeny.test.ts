import { describe, it, expect } from "vitest";
import {
  emptyMcpToolDenyFile,
  parseMcpToolDenyFile,
  resolveExposedMcpTools,
  withToolDenied,
} from "../../../modules/coding/mcp/McpToolDeny.js";

describe("McpToolDeny tightens-only invariant (v1.18.0 Phase 3 OW-A5)", () => {
  it("a policy-dropped server exposes nothing even under adversarial enables", () => {
    const result = resolveExposedMcpTools({
      serverName: "exa-web-search",
      policyVerdict: "drop",
      discoveredTools: ["search", "scrape"],
      userDenied: [],
      userRequestedEnable: ["search", "scrape", "invented"],
    });
    expect(result.exposed).toEqual([]);
    expect(result.rejectedEnables).toEqual(["search", "scrape", "invented"]);
    expect(result.tools.every((t) => t.reason === "policy-denied")).toBe(true);
  });

  it("user deny subtracts from a policy-allowed server and cannot invent tools", () => {
    const result = resolveExposedMcpTools({
      serverName: "github",
      policyVerdict: "allow",
      discoveredTools: ["create_issue", "search"],
      userDenied: ["create_issue"],
      userRequestedEnable: ["create_issue", "not-a-tool"],
    });
    expect(result.exposed).toEqual(["search"]);
    expect(result.rejectedEnables).toEqual(["create_issue", "not-a-tool"]);
  });

  it("withToolDenied refuses to undeny a policy-dropped server", () => {
    const file = emptyMcpToolDenyFile();
    const denied = withToolDenied(file, {
      serverName: "firecrawl",
      toolName: "scrape",
      denied: false,
      policyVerdict: "drop",
    });
    expect(denied.applied).toBe(false);
    expect(denied.file).toBe(file);
  });

  it("withToolDenied on an allowed server records a user deny", () => {
    const next = withToolDenied(emptyMcpToolDenyFile(), {
      serverName: "github",
      toolName: "create_issue",
      denied: true,
      policyVerdict: "allow",
    });
    expect(next.applied).toBe(true);
    expect(next.file.servers.github?.deniedTools).toEqual(["create_issue"]);
  });

  it("parseMcpToolDenyFile fails closed on junk", () => {
    expect(parseMcpToolDenyFile(null)).toEqual(emptyMcpToolDenyFile());
    expect(parseMcpToolDenyFile({ version: 99, servers: {} })).toEqual(emptyMcpToolDenyFile());
  });
});
