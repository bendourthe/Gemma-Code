import { describe, it, expect } from "vitest";
import {
  filterHubRegistry,
  classifyHubMcpServer,
  readClassification,
} from "../../../modules/coding/mcp/HubRegistryPolicyFilter.js";

describe("HubRegistryPolicyFilter (HUB.P3.MCPCFG)", () => {
  it("reads the Classification token from a _comment", () => {
    expect(readClassification("GitHub wrapper. Classification: vendor-intrinsic. ...")).toBe(
      "vendor-intrinsic",
    );
    expect(readClassification("Local. Classification: already-local.")).toBe("already-local");
    expect(readClassification("no marker")).toBe("");
    expect(readClassification(undefined)).toBe("");
  });

  it("allows already-local and vendor-intrinsic, drops everything else", () => {
    expect(
      classifyHubMcpServer("filesystem", { command: "npx", _comment: "Classification: already-local." }).verdict,
    ).toBe("allow");
    expect(
      classifyHubMcpServer("github", { command: "npx", _comment: "Classification: vendor-intrinsic. audit..." }).verdict,
    ).toBe("allow");
    // search-as-service / re-partial / unclassified -> drop
    expect(
      classifyHubMcpServer("exa-web-search", { command: "npx", _comment: "Classification: drop-outright." }).verdict,
    ).toBe("drop");
    expect(classifyHubMcpServer("mystery", { command: "npx", _comment: "no classification" }).verdict).toBe("drop");
  });

  it("drops a server missing its command even when classified allowed", () => {
    expect(classifyHubMcpServer("broken", { _comment: "Classification: already-local." }).verdict).toBe("drop");
  });

  it("filters a registry: keeps policy-compliant servers, drops the rest, maps to config shape", () => {
    const registry = {
      mcpServers: {
        "nexus-skill-server": { command: "python", args: ["-m", "server"], _comment: "internal. Classification: already-local." },
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "${vault:GITHUB_TOKEN}", lowercase: "x" },
          _comment: "Classification: vendor-intrinsic. who-runs/outbound/keys/transmits/relationship answered.",
        },
        "exa-web-search": { command: "npx", _comment: "search-as-service. Classification: drop-outright." },
        firecrawl: { command: "npx", _comment: "scraping. Classification: re-full." },
      },
    };
    const { allowed, decisions } = filterHubRegistry(registry);
    expect(allowed.map((s) => s.name)).toEqual(["github", "nexus-skill-server"]);
    // disallowed servers are dropped
    expect(decisions.filter((d) => d.verdict === "drop").map((d) => d.name)).toEqual([
      "exa-web-search",
      "firecrawl",
    ]);
    // env is filtered to SHOUTING_SNAKE_CASE keys + stdio transport set
    const gh = allowed.find((s) => s.name === "github")!;
    expect(gh.transport).toBe("stdio");
    expect(gh.env).toEqual({ GITHUB_TOKEN: "${vault:GITHUB_TOKEN}" });
  });

  it("default-denies an entirely unclassified registry", () => {
    const { allowed } = filterHubRegistry({
      mcpServers: { foo: { command: "x" }, bar: { command: "y" } },
    });
    expect(allowed).toEqual([]);
  });
});
