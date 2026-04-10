import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type { ToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { ToolHandler, ToolResult } from "../../../src/tools/types.js";

// Mock the MCP SDK server before importing McpServer.
const mockServerTool = vi.fn();
const mockServerConnect = vi.fn();
const mockServerClose = vi.fn();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    tool: mockServerTool,
    connect: mockServerConnect,
    close: mockServerClose,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

const { McpServer } = await import("../../../src/mcp/McpServer.js");

const TEST_CATALOG: ToolMetadata[] = [
  {
    name: "read_file",
    description: "Read a file's content",
    parameters: {
      path: { type: "string", description: "File path", required: true },
    },
  },
  {
    name: "list_directory",
    description: "List directory contents",
    parameters: {
      path: { type: "string", description: "Directory path" },
    },
  },
];

function makeHandler(result: ToolResult): ToolHandler {
  return { execute: vi.fn().mockResolvedValue(result) };
}

describe("McpServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerConnect.mockResolvedValue(undefined);
    mockServerClose.mockResolvedValue(undefined);
  });

  it("starts and registers tools via the SDK", async () => {
    const registry = new ToolRegistry();
    registry.register("read_file", makeHandler({ id: "1", success: true, output: "file" }));
    registry.register("list_directory", makeHandler({ id: "2", success: true, output: "dir" }));

    const server = new McpServer(registry, TEST_CATALOG);
    await server.start();

    expect(server.isRunning).toBe(true);
    // One server.tool() call per catalog entry.
    expect(mockServerTool).toHaveBeenCalledTimes(2);
    expect(mockServerConnect).toHaveBeenCalledTimes(1);
  });

  it("tool handler delegates to ToolRegistry.execute()", async () => {
    const handler = makeHandler({ id: "1", success: true, output: "hello world" });
    const registry = new ToolRegistry();
    registry.register("read_file", handler);

    const server = new McpServer(registry, [TEST_CATALOG[0]!]);
    await server.start();

    // Extract the handler callback: server.tool(name, description, callback).
    const toolCallArgs = mockServerTool.mock.calls[0]!;
    const toolHandler = toolCallArgs[2] as (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }>;

    const result = await toolHandler({ path: "src/index.ts" });

    expect(result.content[0]!.text).toBe("hello world");
    expect(result.isError).toBe(false);
    expect(handler.execute).toHaveBeenCalledWith({ path: "src/index.ts" });
  });

  it("tool handler returns error when tool fails", async () => {
    const handler = makeHandler({ id: "1", success: false, output: "", error: "file not found" });
    const registry = new ToolRegistry();
    registry.register("read_file", handler);

    const server = new McpServer(registry, [TEST_CATALOG[0]!]);
    await server.start();

    const toolHandler = mockServerTool.mock.calls[0]![2] as (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }>;
    const result = await toolHandler({ path: "missing.ts" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("file not found");
  });

  it("stop() shuts down the server", async () => {
    const registry = new ToolRegistry();
    const server = new McpServer(registry, []);
    await server.start();
    await server.stop();

    expect(server.isRunning).toBe(false);
    expect(mockServerClose).toHaveBeenCalledTimes(1);
  });

  it("start() is idempotent", async () => {
    const registry = new ToolRegistry();
    const server = new McpServer(registry, []);
    await server.start();
    await server.start();

    expect(mockServerConnect).toHaveBeenCalledTimes(1);
  });

  it("stop() is a no-op when not running", async () => {
    const registry = new ToolRegistry();
    const server = new McpServer(registry, []);
    await server.stop();

    expect(mockServerClose).not.toHaveBeenCalled();
  });
});
