import { describe, it, expect, vi } from "vitest";
import { McpToolHandler } from "../../../modules/coding/mcp/McpToolHandler.js";
import type { McpClient } from "../../../modules/coding/mcp/McpClient.js";
import type { ToolResult } from "../../../src/tools/types.js";
import { mockOf } from "../../helpers/factories.js";

function makeClient(
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
): McpClient {
  return mockOf<McpClient>({ callTool });
}

describe("McpToolHandler", () => {
  it("delegates execute() to McpClient.callTool with the wrapped tool name", async () => {
    const callTool = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      id: "",
      success: true,
      output: "hello from search",
    }));

    const handler = new McpToolHandler(makeClient(callTool), "search");
    const result = await handler.execute({ query: "anthropic" });

    expect(callTool).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledWith("search", { query: "anthropic" });
    expect(result).toEqual({ id: "", success: true, output: "hello from search" });
  });

  it("propagates error results unchanged from the MCP client", async () => {
    const callTool = vi.fn(async () => ({
      id: "",
      success: false,
      output: "",
      error: "tool crashed",
    }));

    const handler = new McpToolHandler(makeClient(callTool), "fetch");
    const result = await handler.execute({ url: "http://localhost" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("tool crashed");
  });

  it("bubbles up rejections from the client as a rejected promise", async () => {
    const callTool = vi.fn(async () => {
      throw new Error("timeout after 30s");
    });

    const handler = new McpToolHandler(makeClient(callTool), "slow-tool");
    await expect(handler.execute({})).rejects.toThrow(/timeout after 30s/);
  });

  it("passes argument objects through by reference without copying or mutation", async () => {
    let captured: Record<string, unknown> | undefined;
    const callTool = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      captured = args;
      return { id: "", success: true, output: "ok" };
    });

    const args = { query: "foo", nested: { depth: 2 }, list: [1, 2, 3] };
    const handler = new McpToolHandler(makeClient(callTool), "search");
    await handler.execute(args);

    // Handler should not re-shape or clone the arguments.
    expect(captured).toBe(args);
    expect(captured).toEqual({ query: "foo", nested: { depth: 2 }, list: [1, 2, 3] });
  });
});
