/**
 * Integration: the MCP registry resolves `${vault}` env references from the
 * OS-keychain-backed CredentialVault, not from the plaintext mcp.json
 * (v1.5.0 Phase 1 T002 acceptance). Uses a real KeychainCredentialVault over
 * an in-memory keychain backend; only McpClient + fs are mocked since they are
 * not part of the credential-resolution path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import { KeychainCredentialVault } from "../../../core/security/CredentialVault.js";
import { InMemoryKeychainBackend } from "../../../core/security/KeychainBackend.js";

// McpClient is mocked so initialize() does not spawn a real subprocess; the
// credential resolution happens in McpManager before any client connects.
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
vi.mock("../../../modules/coding/mcp/McpClient.js", () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    get tools() {
      return [];
    },
    get status() {
      return "connected";
    },
    get error() {
      return undefined;
    },
  })),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return { ...actual, existsSync: vi.fn(() => false), readFileSync: vi.fn(() => "{}") };
});

const { McpManager } = await import("../../../modules/coding/mcp/McpManager.js");

function mockGlobalConfig(configJson: string): void {
  const homedir = os.homedir();
  vi.mocked(fs.existsSync).mockImplementation(
    (p) => typeof p === "string" && p.startsWith(homedir) && p.includes("mcp.json"),
  );
  vi.mocked(fs.readFileSync).mockReturnValue(configJson);
}

describe("MCP credential-vault integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
  });

  it("resolves a ${vault} env ref from the keychain, not the config file", async () => {
    const SECRET = "resolved-secret-123";
    const configJson = JSON.stringify({
      servers: [
        {
          name: "vault-server",
          command: "cmd",
          transport: "stdio",
          env: {
            API_KEY: "${vault}",
            PATH: "/usr/bin",
            PLAINTEXT_SECRET: "sk-literal-leak",
          },
        },
      ],
    });
    mockGlobalConfig(configJson);

    const vault = new KeychainCredentialVault(new InMemoryKeychainBackend());
    await vault.set("vault-server", "API_KEY", SECRET);

    const manager = new McpManager(new ToolRegistry(), undefined, undefined, undefined, vault);
    await manager.initialize();

    const env = manager.getServerStates()[0]?.config.env ?? {};
    // Secret came from the vault.
    expect(env.API_KEY).toBe(SECRET);
    // Whitelisted key passes through; literal non-whitelisted secret is dropped.
    expect(env.PATH).toBe("/usr/bin");
    expect(env.PLAINTEXT_SECRET).toBeUndefined();
    // The plaintext config only ever held the placeholder, never the secret.
    expect(configJson).toContain("${vault}");
    expect(configJson).not.toContain(SECRET);
  });

  it("resolves a named ${vault:NAME} ref against the named vault key", async () => {
    const configJson = JSON.stringify({
      servers: [
        {
          name: "vault-server",
          command: "cmd",
          transport: "stdio",
          env: { TOKEN: "${vault:SHARED}" },
        },
      ],
    });
    mockGlobalConfig(configJson);

    const vault = new KeychainCredentialVault(new InMemoryKeychainBackend());
    await vault.set("vault-server", "SHARED", "shared-secret");

    const manager = new McpManager(new ToolRegistry(), undefined, undefined, undefined, vault);
    await manager.initialize();

    expect(manager.getServerStates()[0]?.config.env?.TOKEN).toBe("shared-secret");
  });

  it("drops a ${vault} ref when no vault is wired (never forwards a placeholder)", async () => {
    const configJson = JSON.stringify({
      servers: [
        { name: "vault-server", command: "cmd", transport: "stdio", env: { API_KEY: "${vault}" } },
      ],
    });
    mockGlobalConfig(configJson);

    const manager = new McpManager(new ToolRegistry()); // no vault
    await manager.initialize();

    const env = manager.getServerStates()[0]?.config.env ?? {};
    expect(env.API_KEY).toBeUndefined();
  });

  it("drops a ${vault} ref when the secret is absent from the vault", async () => {
    const configJson = JSON.stringify({
      servers: [
        { name: "vault-server", command: "cmd", transport: "stdio", env: { API_KEY: "${vault}" } },
      ],
    });
    mockGlobalConfig(configJson);

    const vault = new KeychainCredentialVault(new InMemoryKeychainBackend()); // empty
    const manager = new McpManager(new ToolRegistry(), undefined, undefined, undefined, vault);
    await manager.initialize();

    expect(manager.getServerStates()[0]?.config.env?.API_KEY).toBeUndefined();
  });
});
