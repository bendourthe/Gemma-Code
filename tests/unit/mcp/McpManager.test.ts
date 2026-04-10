import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type { McpServerConfig } from "../../../src/mcp/McpTypes.js";
import type { McpToolName } from "../../../src/tools/types.js";

// Mock McpClient before importing McpManager.
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockClientTools = vi.fn(() => []);
const mockClientStatus = vi.fn((): "disconnected" | "connecting" | "connected" | "error" => "connected");
const mockClientError = vi.fn(() => undefined);

vi.mock("../../../src/mcp/McpClient.js", () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    get tools() { return mockClientTools(); },
    get status() { return mockClientStatus(); },
    get error() { return mockClientError(); },
  })),
}));

// Mock fs to control config loading.
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
  };
});

const { McpManager } = await import("../../../src/mcp/McpManager.js");

const TEST_CONFIG: McpServerConfig = {
  name: "test-server",
  command: "test-cmd",
  args: ["--flag"],
  transport: "stdio",
};

const TEST_TOOL = {
  serverName: "test-server",
  name: "search",
  qualifiedName: "mcp:test-server/search" as McpToolName,
  description: "Search",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Query string" } },
    required: ["query"],
  },
};

describe("McpManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockClientTools.mockReturnValue([TEST_TOOL]);
    mockClientStatus.mockReturnValue("connected");
    mockClientError.mockReturnValue(undefined);
  });

  it("getServerStates() returns empty when no configs loaded", () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    expect(manager.getServerStates()).toEqual([]);
  });

  it("connectServer() connects and registers tools in the registry", async () => {
    const configJson = JSON.stringify({ servers: [TEST_CONFIG] });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return typeof p === "string" && p.includes("mcp.json");
    });
    vi.mocked(fs.readFileSync).mockReturnValue(configJson);

    const registry = new ToolRegistry();
    const manager = new McpManager(registry, "/workspace");
    await manager.initialize();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(registry.has("mcp:test-server/search" as McpToolName)).toBe(true);
  });

  it("getAllToolMetadata() returns DynamicToolMetadata for connected tools", async () => {
    const configJson = JSON.stringify({ servers: [TEST_CONFIG] });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(configJson);

    const registry = new ToolRegistry();
    const manager = new McpManager(registry, "/workspace");
    await manager.initialize();

    const metadata = manager.getAllToolMetadata();
    expect(metadata).toHaveLength(1);
    expect(metadata[0]!.name).toBe("mcp:test-server/search");
    expect(metadata[0]!.source).toBe("mcp");
    expect(metadata[0]!.priority).toBe(100);
    expect(metadata[0]!.parameters.query).toBeDefined();
  });

  it("disconnectServer() removes the client", async () => {
    const configJson = JSON.stringify({ servers: [TEST_CONFIG] });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(configJson);

    const registry = new ToolRegistry();
    const manager = new McpManager(registry, "/workspace");
    await manager.initialize();

    await manager.disconnectServer("test-server");

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    // After disconnect, tools should be disabled.
    expect(registry.isEnabled("mcp:test-server/search" as McpToolName)).toBe(false);
  });

  it("connectServer() throws for unknown server name", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    await expect(manager.connectServer("nonexistent")).rejects.toThrow(/No MCP server configured/);
  });

  it("getServerStates() reflects connection status", async () => {
    const configJson = JSON.stringify({ servers: [TEST_CONFIG] });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(configJson);

    const registry = new ToolRegistry();
    const manager = new McpManager(registry, "/workspace");
    await manager.initialize();

    const states = manager.getServerStates();
    expect(states).toHaveLength(1);
    expect(states[0]!.config.name).toBe("test-server");
    expect(states[0]!.status).toBe("connected");
    expect(states[0]!.tools).toHaveLength(1);
  });

  it("dispose() disconnects all clients", async () => {
    const configJson = JSON.stringify({ servers: [TEST_CONFIG] });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(configJson);

    const registry = new ToolRegistry();
    const manager = new McpManager(registry, "/workspace");
    await manager.initialize();

    manager.dispose();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("workspace config overrides global config for same-named server", async () => {
    const globalConfig = JSON.stringify({ servers: [{ ...TEST_CONFIG, command: "global-cmd" }] });
    const localConfig = JSON.stringify({ servers: [{ ...TEST_CONFIG, command: "local-cmd" }] });

    const homedir = os.homedir();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (typeof p === "string" && p.startsWith(homedir)) return globalConfig;
      return localConfig;
    });

    const registry = new ToolRegistry();
    const manager = new McpManager(registry, "/workspace");
    await manager.initialize();

    const states = manager.getServerStates();
    // Should have one server (workspace overrides global for same name).
    expect(states).toHaveLength(1);
  });

  it("handles invalid config file gracefully", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json!!!{");

    const registry = new ToolRegistry();
    const manager = new McpManager(registry, "/workspace");
    await manager.initialize();

    expect(manager.getServerStates()).toEqual([]);
  });
});
