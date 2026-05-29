/**
 * v1.2.0 Phase 6.2 -- unit tests for the LSP MCP adapter.
 *
 * Uses a fake `LspClient` (injected via `LspMcpServerOptions.client`) so
 * the tests exercise tool-dispatch + arg parsing in isolation from the
 * stdio framing.
 */

import { describe, it, expect } from "vitest";
import {
  LspClient,
  type LspChildProcessLauncher,
  type LspDefinitionRequest,
  type LspLocation,
  type LspReferencesRequest,
  type LspResult,
} from "../../../../core/coding/lsp/LspClient.js";
import {
  LspMcpServer,
  LSP_TOOL_NAMES,
} from "../../../../core/coding/lsp/LspMcpServer.js";

class FakeClient extends LspClient {
  defCalls: LspDefinitionRequest[] = [];
  refCalls: LspReferencesRequest[] = [];
  defResult: LspResult<LspLocation> = { ok: true, locations: [] };
  refResult: LspResult<LspLocation> = { ok: true, locations: [] };

  constructor() {
    // Provide a launcher that returns null so the base class never tries
    // to spawn a real process if any code path leaks through.
    const launcher: LspChildProcessLauncher = { launch: () => null };
    super({ launcher });
  }

  override async definition(req: LspDefinitionRequest): Promise<LspResult<LspLocation>> {
    this.defCalls.push(req);
    return this.defResult;
  }

  override async references(req: LspReferencesRequest): Promise<LspResult<LspLocation>> {
    this.refCalls.push(req);
    return this.refResult;
  }
}

describe("LspMcpServer", () => {
  it("lists exactly the 2 LSP tool names", () => {
    const server = new LspMcpServer({ client: new FakeClient() });
    const tools = server.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...LSP_TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.serverId).toBe("nexus.lsp");
      // Schema is JSON-encoded so the extension UI can render it raw.
      expect(() => JSON.parse(t.inputSchema)).not.toThrow();
    }
  });

  it("dispatches lsp_definition through to the underlying client", async () => {
    const fake = new FakeClient();
    fake.defResult = {
      ok: true,
      locations: [
        {
          uri: "file:///tmp/x.ts",
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
        },
      ],
    };
    const server = new LspMcpServer({ client: fake });
    const res = await server.invokeTool("lsp_definition", {
      language: "typescript",
      filePath: "/tmp/x.ts",
      line: 1,
      column: 2,
      fileContents: "// content",
    });
    expect(res.ok).toBe(true);
    expect(fake.defCalls).toHaveLength(1);
    const parsed = JSON.parse(res.result ?? "") as LspResult<LspLocation>;
    expect(parsed.locations).toHaveLength(1);
    expect(parsed.locations?.[0]?.range.start.line).toBe(1);
  });

  it("dispatches lsp_references and forwards includeDeclaration", async () => {
    const fake = new FakeClient();
    const server = new LspMcpServer({ client: fake });
    await server.invokeTool("lsp_references", {
      language: "python",
      filePath: "/tmp/m.py",
      line: 4,
      column: 0,
      fileContents: "def foo(): pass",
      includeDeclaration: true,
    });
    expect(fake.refCalls).toHaveLength(1);
    expect(fake.refCalls[0]!.includeDeclaration).toBe(true);
  });

  it("rejects unknown tool names", async () => {
    const server = new LspMcpServer({ client: new FakeClient() });
    const res = await server.invokeTool("not_a_real_tool", {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Unknown LSP tool/);
  });

  it("validates required arguments", async () => {
    const server = new LspMcpServer({ client: new FakeClient() });
    const res = await server.invokeTool("lsp_definition", {
      language: "typescript",
      // missing filePath
      line: 0,
      column: 0,
      fileContents: "",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Missing string argument: filePath/);
  });

  it("rejects unsupported languages", async () => {
    const server = new LspMcpServer({ client: new FakeClient() });
    const res = await server.invokeTool("lsp_definition", {
      language: "fortran",
      filePath: "/tmp/x.f90",
      line: 0,
      column: 0,
      fileContents: "",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Unsupported or missing language/);
  });

  it("surfaces client-level errors through the MCP result", async () => {
    const fake = new FakeClient();
    fake.defResult = { ok: false, error: "LSP server not installed" };
    const server = new LspMcpServer({ client: fake });
    const res = await server.invokeTool("lsp_definition", {
      language: "rust",
      filePath: "/tmp/x.rs",
      line: 0,
      column: 0,
      fileContents: "",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("LSP server not installed");
  });
});
