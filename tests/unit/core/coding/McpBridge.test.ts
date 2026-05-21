import { describe, it, expect, vi } from "vitest";
import {
  buildMcpHandlers,
  buildMcpInvokeHandler,
  buildMcpListHandler,
  MCP_INVOKE_METHOD,
  MCP_LIST_METHOD,
  type McpHarnessAdapter,
  type McpToolDescriptor,
} from "../../../../core/coding/McpBridge.js";

const TOOLS: readonly McpToolDescriptor[] = Object.freeze([
  {
    name: "github.create_issue",
    description: "Open a GitHub issue.",
    inputSchema: '{"type":"object","properties":{"title":{"type":"string"}}}',
    serverId: "github-mcp",
  },
  {
    name: "fs.read",
    description: "Read a file.",
    inputSchema: '{"type":"object","properties":{"path":{"type":"string"}}}',
    serverId: "fs-mcp",
  },
]);

function fakeHarness(overrides: Partial<McpHarnessAdapter> = {}): McpHarnessAdapter {
  return {
    listTools: () => TOOLS,
    invokeTool: vi.fn(async (name: string) => ({
      ok: true,
      toolName: name,
      result: `result-of-${name}`,
    })),
    ...overrides,
  };
}

describe("buildMcpListHandler", () => {
  it("returns every tool the harness exposes", async () => {
    const handler = buildMcpListHandler(fakeHarness());
    const response = await handler();
    expect(response.tools).toHaveLength(2);
    expect(response.tools.map((t) => t.name)).toEqual([
      "github.create_issue",
      "fs.read",
    ]);
  });

  it("awaits an async listTools implementation", async () => {
    const harness = fakeHarness({
      listTools: async () => TOOLS,
    });
    const handler = buildMcpListHandler(harness);
    const response = await handler();
    expect(response.tools).toHaveLength(2);
  });
});

describe("buildMcpInvokeHandler", () => {
  it("rejects missing or empty tool names with a structured error", async () => {
    const handler = buildMcpInvokeHandler(fakeHarness());
    const response = await handler({
      name: "",
      args: {},
    } as unknown as { name: string; args: Record<string, unknown> });
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/missing or empty/);
  });

  it("forwards args to the harness and returns the structured result", async () => {
    const invoke = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      ok: true,
      toolName: "fs.read",
      result: "hello",
    }));
    const handler = buildMcpInvokeHandler({ ...fakeHarness(), invokeTool: invoke });
    const response = await handler({ name: "fs.read", args: { path: "a.ts" } });
    expect(invoke).toHaveBeenCalledWith("fs.read", { path: "a.ts" });
    expect(response.ok).toBe(true);
    expect(response.toolName).toBe("fs.read");
    expect(response.result).toBe("hello");
  });

  it("converts thrown errors into structured failures (does not propagate)", async () => {
    const handler = buildMcpInvokeHandler({
      ...fakeHarness(),
      invokeTool: vi.fn(async () => {
        throw new Error("harness exploded");
      }),
    });
    const response = await handler({ name: "fs.read", args: {} });
    expect(response.ok).toBe(false);
    expect(response.error).toBe("harness exploded");
  });

  it("normalizes missing result/error fields to null", async () => {
    const handler = buildMcpInvokeHandler({
      ...fakeHarness(),
      invokeTool: vi.fn(async () => ({ ok: true, toolName: "x" })),
    });
    const response = await handler({ name: "x", args: {} });
    expect(response.result).toBeNull();
    expect(response.error).toBeNull();
  });
});

describe("buildMcpHandlers", () => {
  it("exposes both methods bound to the same harness", async () => {
    const handlers = buildMcpHandlers(fakeHarness());
    const list = await handlers.list();
    expect(list.tools).toHaveLength(2);
    const invoked = await handlers.invoke({ name: "fs.read", args: {} });
    expect(invoked.ok).toBe(true);
  });
});

describe("IPC method ids", () => {
  it("exports the canonical method ids", () => {
    expect(MCP_LIST_METHOD).toBe("mcp.list");
    expect(MCP_INVOKE_METHOD).toBe("mcp.invoke");
  });
});
