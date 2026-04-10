import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP SDK before importing McpClient.
const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: mockCallTool,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));

const { McpClient } = await import("../../../src/mcp/McpClient.js");

const TEST_CONFIG = {
  name: "test-server",
  command: "test-mcp-server",
  args: ["--port", "8080"] as const,
  transport: "stdio" as const,
};

describe("McpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: "search",
          description: "Search for items",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
        {
          name: "fetch",
          description: "Fetch a resource",
          inputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
          },
        },
      ],
    });
  });

  it("starts in disconnected state", () => {
    const client = new McpClient(TEST_CONFIG);
    expect(client.status).toBe("disconnected");
    expect(client.tools).toHaveLength(0);
  });

  it("connect() establishes connection and discovers tools", async () => {
    const client = new McpClient(TEST_CONFIG);
    await client.connect();

    expect(client.status).toBe("connected");
    expect(client.tools).toHaveLength(2);
    expect(client.tools[0]!.qualifiedName).toBe("mcp:test-server/search");
    expect(client.tools[1]!.qualifiedName).toBe("mcp:test-server/fetch");
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockListTools).toHaveBeenCalledTimes(1);
  });

  it("connect() sets status to error on failure", async () => {
    mockConnect.mockRejectedValueOnce(new Error("connection refused"));
    const client = new McpClient(TEST_CONFIG);

    await expect(client.connect()).rejects.toThrow("connection refused");
    expect(client.status).toBe("error");
    expect(client.error).toBe("connection refused");
    expect(client.tools).toHaveLength(0);
  });

  it("connect() is a no-op if already connected", async () => {
    const client = new McpClient(TEST_CONFIG);
    await client.connect();
    await client.connect();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("disconnect() resets state", async () => {
    const client = new McpClient(TEST_CONFIG);
    await client.connect();
    await client.disconnect();

    expect(client.status).toBe("disconnected");
    expect(client.tools).toHaveLength(0);
    expect(client.error).toBeUndefined();
  });

  it("callTool() delegates to the MCP client", async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "result data" }],
    });

    const client = new McpClient(TEST_CONFIG);
    await client.connect();
    const result = await client.callTool("search", { query: "test" });

    expect(result.success).toBe(true);
    expect(result.output).toBe("result data");
    expect(mockCallTool).toHaveBeenCalledWith({
      name: "search",
      arguments: { query: "test" },
    });
  });

  it("callTool() returns error when not connected", async () => {
    const client = new McpClient(TEST_CONFIG);
    const result = await client.callTool("search", { query: "test" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not connected/);
  });

  it("callTool() handles MCP errors", async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "something went wrong" }],
      isError: true,
    });

    const client = new McpClient(TEST_CONFIG);
    await client.connect();
    const result = await client.callTool("search", { query: "fail" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("something went wrong");
  });

  it("callTool() handles thrown exceptions", async () => {
    mockCallTool.mockRejectedValue(new Error("network timeout"));

    const client = new McpClient(TEST_CONFIG);
    await client.connect();
    const result = await client.callTool("search", { query: "timeout" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("network timeout");
  });

  it("listTools() result includes correct tool metadata", async () => {
    const client = new McpClient(TEST_CONFIG);
    await client.connect();

    const tool = client.tools[0]!;
    expect(tool.serverName).toBe("test-server");
    expect(tool.name).toBe("search");
    expect(tool.description).toBe("Search for items");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
  });
});
