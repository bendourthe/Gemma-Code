import { describe, it, expect } from "vitest";
import {
  InMemoryKeychainBackend,
  MacOsSecurityBackend,
  LinuxSecretToolBackend,
  WindowsCredentialBackend,
  detectKeychainBackend,
  type KeychainExec,
  type KeychainExecResult,
} from "../../../../core/security/KeychainBackend.js";

interface ExecCall {
  cmd: string;
  args: readonly string[];
  stdin?: string;
}

function recordingExec(
  responder: KeychainExecResult | ((call: ExecCall) => KeychainExecResult),
): { exec: KeychainExec; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const exec: KeychainExec = async (cmd, args, stdin) => {
    const call: ExecCall = { cmd, args, stdin };
    calls.push(call);
    return typeof responder === "function" ? responder(call) : responder;
  };
  return { exec, calls };
}

const OK = (stdout = ""): KeychainExecResult => ({ code: 0, stdout, stderr: "" });
const FAIL = (): KeychainExecResult => ({ code: 1, stdout: "", stderr: "boom" });

describe("InMemoryKeychainBackend", () => {
  it("round-trips set/get and deletes", async () => {
    const b = new InMemoryKeychainBackend();
    expect(await b.isAvailable()).toBe(true);
    expect(await b.get("Svc", "API_KEY")).toBeNull();
    await b.set("Svc", "API_KEY", "secret-xyz");
    expect(await b.get("Svc", "API_KEY")).toBe("secret-xyz");
    expect(await b.delete("Svc", "API_KEY")).toBe(true);
    expect(await b.delete("Svc", "API_KEY")).toBe(false);
    expect(await b.get("Svc", "API_KEY")).toBeNull();
  });

  it("lists accounts scoped to a service", async () => {
    const b = new InMemoryKeychainBackend();
    await b.set("Nexus:server-a", "API_KEY", "a");
    await b.set("Nexus:server-a", "TOKEN", "b");
    await b.set("Nexus:server-b", "API_KEY", "c");
    expect((await b.list("Nexus:server-a")).slice().sort()).toEqual(["API_KEY", "TOKEN"]);
    expect(await b.list("Nexus:server-b")).toEqual(["API_KEY"]);
  });
});

describe("MacOsSecurityBackend", () => {
  it("builds a find-generic-password get and trims the value", async () => {
    const { exec, calls } = recordingExec(OK("secret-value\n"));
    const b = new MacOsSecurityBackend(exec);
    expect(await b.get("Svc", "Acc")).toBe("secret-value");
    expect(calls[0]?.cmd).toBe("security");
    expect(calls[0]?.args).toEqual([
      "find-generic-password",
      "-s",
      "Svc",
      "-a",
      "Acc",
      "-w",
    ]);
  });

  it("returns null when the keychain item is missing", async () => {
    const { exec } = recordingExec(FAIL());
    const b = new MacOsSecurityBackend(exec);
    expect(await b.get("Svc", "Acc")).toBeNull();
  });

  it("updates in place on set (-U) and passes the secret", async () => {
    const { exec, calls } = recordingExec(OK());
    const b = new MacOsSecurityBackend(exec);
    await b.set("Svc", "Acc", "sk-123");
    expect(calls[0]?.args).toContain("-U");
    expect(calls[0]?.args).toContain("sk-123");
  });
});

describe("LinuxSecretToolBackend", () => {
  it("passes the secret on stdin for set (off the argv vector)", async () => {
    const { exec, calls } = recordingExec(OK());
    const b = new LinuxSecretToolBackend(exec);
    await b.set("Svc", "Acc", "top-secret");
    expect(calls[0]?.cmd).toBe("secret-tool");
    expect(calls[0]?.args[0]).toBe("store");
    expect(calls[0]?.stdin).toBe("top-secret");
    // The secret never appears in argv.
    expect(calls[0]?.args.join(" ")).not.toContain("top-secret");
  });

  it("parses account attributes from a search listing", async () => {
    const listing = [
      "[/org/freedesktop/secrets/collection/login/1]",
      "label = Nexus:srv/API_KEY",
      "secret = ...",
      "attribute.service = Nexus:srv",
      "attribute.account = API_KEY",
      "attribute.account = TOKEN",
    ].join("\n");
    const { exec } = recordingExec(OK(listing));
    const b = new LinuxSecretToolBackend(exec);
    expect(await b.list("Nexus:srv")).toEqual(["API_KEY", "TOKEN"]);
  });
});

describe("WindowsCredentialBackend", () => {
  it("constructs a PasswordVault get with quoted resource/account", async () => {
    const { exec, calls } = recordingExec(OK("the-pass"));
    const b = new WindowsCredentialBackend(exec);
    expect(await b.get("Nexus:srv", "API_KEY")).toBe("the-pass");
    const script = calls[0]?.args[calls[0].args.length - 1] ?? "";
    expect(calls[0]?.cmd).toBe("powershell");
    expect(script).toContain("PasswordVault");
    expect(script).toContain("'Nexus:srv'");
    expect(script).toContain("'API_KEY'");
  });

  it("reads the secret from stdin on set (off the argv vector)", async () => {
    const { exec, calls } = recordingExec(OK());
    const b = new WindowsCredentialBackend(exec);
    await b.set("Nexus:srv", "API_KEY", "win-secret");
    expect(calls[0]?.stdin).toBe("win-secret");
    expect((calls[0]?.args ?? []).join(" ")).not.toContain("win-secret");
  });
});

describe("detectKeychainBackend", () => {
  it("selects the platform backend", () => {
    expect(detectKeychainBackend({ platform: "darwin" }).name).toBe("macos-security");
    expect(detectKeychainBackend({ platform: "win32" }).name).toBe("windows-passwordvault");
    expect(detectKeychainBackend({ platform: "linux" }).name).toBe("linux-secret-tool");
    // Unknown platforms degrade to the libsecret backend.
    expect(detectKeychainBackend({ platform: "freebsd" }).name).toBe("linux-secret-tool");
  });
});
