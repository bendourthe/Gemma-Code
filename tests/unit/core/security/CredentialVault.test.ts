import { describe, it, expect } from "vitest";
import {
  KeychainCredentialVault,
  KeychainUnavailableError,
  createCredentialVault,
  type VaultLogLevel,
} from "../../../../core/security/CredentialVault.js";
import {
  InMemoryKeychainBackend,
  type KeychainBackend,
} from "../../../../core/security/KeychainBackend.js";

function capturingLogger(): {
  log: (level: VaultLogLevel, message: string) => void;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    log: (level, message) => lines.push(`${level} ${message}`),
  };
}

describe("KeychainCredentialVault", () => {
  it("round-trips a secret scoped per integration", async () => {
    const vault = new KeychainCredentialVault(new InMemoryKeychainBackend());
    expect(await vault.get("server-a", "API_KEY")).toBeUndefined();
    await vault.set("server-a", "API_KEY", "secret-xyz");
    expect(await vault.get("server-a", "API_KEY")).toBe("secret-xyz");
    // A different integration is a separate namespace.
    expect(await vault.get("server-b", "API_KEY")).toBeUndefined();
  });

  it("lists keys and deletes scoped per integration", async () => {
    const vault = new KeychainCredentialVault(new InMemoryKeychainBackend());
    await vault.set("srv", "API_KEY", "a");
    await vault.set("srv", "TOKEN", "b");
    expect((await vault.list("srv")).slice().sort()).toEqual(["API_KEY", "TOKEN"]);
    expect(await vault.delete("srv", "API_KEY")).toBe(true);
    expect(await vault.list("srv")).toEqual(["TOKEN"]);
  });

  it("never writes a secret value to the log on any operation", async () => {
    const logger = capturingLogger();
    const vault = new KeychainCredentialVault(new InMemoryKeychainBackend(), {
      logger: logger.log,
    });
    const SECRET = "super-secret-value-123";
    await vault.set("srv", "API_KEY", SECRET);
    await vault.get("srv", "API_KEY");
    await vault.delete("srv", "API_KEY");
    await vault.list("srv");
    const joined = logger.lines.join("\n");
    expect(joined).not.toContain(SECRET);
    // Log lines reference the integration/key names only.
    expect(joined).toContain("srv/API_KEY");
  });

  it("redacts a secret-shaped backend error before logging and rethrowing", async () => {
    const logger = capturingLogger();
    const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD";
    const failing: KeychainBackend = {
      name: "stub",
      isAvailable: async () => true,
      get: async () => null,
      set: async () => {
        throw new Error(`upstream rejected token ${token}`);
      },
      delete: async () => false,
      list: async () => [],
    };
    const vault = new KeychainCredentialVault(failing, { logger: logger.log });
    await expect(vault.set("srv", "API_KEY", "value")).rejects.toThrow(/<redacted>/);
    const joined = logger.lines.join("\n");
    expect(joined).toContain("<redacted>");
    expect(joined).not.toContain(token);
  });

  it("throws KeychainUnavailableError instead of any plaintext fallback", async () => {
    const unavailable: KeychainBackend = {
      name: "none",
      isAvailable: async () => false,
      get: async () => null,
      set: async () => undefined,
      delete: async () => false,
      list: async () => [],
    };
    const vault = new KeychainCredentialVault(unavailable);
    await expect(vault.get("srv", "API_KEY")).rejects.toBeInstanceOf(KeychainUnavailableError);
    await expect(vault.set("srv", "API_KEY", "v")).rejects.toBeInstanceOf(KeychainUnavailableError);
    await expect(vault.delete("srv", "API_KEY")).rejects.toBeInstanceOf(KeychainUnavailableError);
    expect(await vault.isAvailable()).toBe(false);
  });
});

describe("createCredentialVault", () => {
  it("builds a vault whose availability reflects the platform backend probe", async () => {
    // Inject an exec that reports the keychain tool as present.
    const vault = createCredentialVault({
      platform: "linux",
      exec: async () => ({ code: 0, stdout: "secret-tool", stderr: "" }),
    });
    expect(await vault.isAvailable()).toBe(true);
  });

  it("reports unavailable when the platform tool probe fails", async () => {
    const vault = createCredentialVault({
      platform: "linux",
      exec: async () => ({ code: 127, stdout: "", stderr: "not found" }),
    });
    expect(await vault.isAvailable()).toBe(false);
  });
});
