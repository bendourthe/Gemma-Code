/**
 * v1.5.0 Phase 1 (adoption-ecosystem-2026-06 T002) -- OS-keychain backends.
 *
 * Adopts report item 2 (`local-only`): a positive, keychain-backed store for
 * user-supplied secrets. Rather than wrap a native node module (which would
 * be a new heavy dependency and a third-party wrapper -- both at odds with the
 * project's "zero new heavy dependency" + "originality over wrappers"
 * principles), each backend reverse-engineers OS-keychain access through the
 * platform's own CLI primitive:
 *
 *   - macOS   -> the built-in `security` tool (Keychain Services)
 *   - Linux   -> `secret-tool` (libsecret)
 *   - Windows -> PowerShell + `Windows.Security.Credentials.PasswordVault`
 *
 * Every backend runs through an injected {@link KeychainExec} so the command
 * construction and output parsing are unit-testable without spawning a real
 * process or touching a real keychain. There is no plaintext fallback: when
 * the platform primitive is unavailable, {@link CredentialVault} surfaces a
 * clear error (see KeychainUnavailableError) instead of writing secrets to a
 * config file.
 *
 * Local-only: no backend makes a network call.
 */

import { execFile } from "node:child_process";

/** Result of a keychain CLI invocation. */
export interface KeychainExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a keychain CLI command. `stdin`, when provided, is written to the
 * child's standard input (used to pass secret values off the argv vector).
 * Never rejects: a spawn failure resolves to a non-zero `code`.
 */
export type KeychainExec = (
  cmd: string,
  args: readonly string[],
  stdin?: string,
) => Promise<KeychainExecResult>;

/** A platform store keyed by (service, account). */
export interface KeychainBackend {
  /** Human-readable backend name for diagnostics (no secrets). */
  readonly name: string;
  /** Resolves true when the underlying OS primitive is usable on this host. */
  isAvailable(): Promise<boolean>;
  /** Returns the stored secret, or null when no entry exists. */
  get(service: string, account: string): Promise<string | null>;
  /** Stores (or overwrites) the secret for (service, account). */
  set(service: string, account: string, secret: string): Promise<void>;
  /** Deletes the entry; resolves true when something was removed. */
  delete(service: string, account: string): Promise<boolean>;
  /** Best-effort list of account names under a service. May be empty. */
  list(service: string): Promise<readonly string[]>;
}

const EXEC_TIMEOUT_MS = 5_000;

/** Default {@link KeychainExec} backed by `child_process.execFile`. */
export const defaultKeychainExec: KeychainExec = (cmd, args, stdin) =>
  new Promise<KeychainExecResult>((resolve) => {
    const proc = execFile(
      cmd,
      [...args],
      { timeout: EXEC_TIMEOUT_MS, windowsHide: true },
      (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const errCode = (error as { code?: unknown } | null)?.code;
        const code = typeof errCode === "number" ? errCode : error ? 1 : 0;
        resolve({
          code,
          stdout: typeof stdout === "string" ? stdout : stdout.toString(),
          stderr: typeof stderr === "string" ? stderr : stderr.toString(),
        });
      },
    );
    proc.on("error", () => resolve({ code: 127, stdout: "", stderr: "spawn failed" }));
    if (stdin !== undefined) {
      proc.stdin?.end(stdin);
    }
  });

/**
 * In-process backend used by tests and as an explicit injectable. Holds
 * secrets only in memory; nothing is persisted. Always available.
 */
export class InMemoryKeychainBackend implements KeychainBackend {
  readonly name = "in-memory";
  private readonly _store = new Map<string, string>();

  private _key(service: string, account: string): string {
    return `${service}\t${account}`;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async get(service: string, account: string): Promise<string | null> {
    return this._store.get(this._key(service, account)) ?? null;
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    this._store.set(this._key(service, account), secret);
  }

  async delete(service: string, account: string): Promise<boolean> {
    return this._store.delete(this._key(service, account));
  }

  async list(service: string): Promise<readonly string[]> {
    const prefix = `${service}\t`;
    const out: string[] = [];
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
    }
    return out;
  }
}

/** macOS Keychain via the built-in `security` CLI. */
export class MacOsSecurityBackend implements KeychainBackend {
  readonly name = "macos-security";
  constructor(private readonly _exec: KeychainExec = defaultKeychainExec) {}

  async isAvailable(): Promise<boolean> {
    const r = await this._exec("security", ["help"]);
    return r.code === 0 || /keychain/i.test(r.stdout + r.stderr);
  }

  async get(service: string, account: string): Promise<string | null> {
    const r = await this._exec("security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      account,
      "-w",
    ]);
    if (r.code !== 0) return null;
    const value = r.stdout.replace(/\r?\n$/, "");
    return value.length > 0 ? value : null;
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    // -U updates an existing item in place; -w passes the secret.
    const r = await this._exec("security", [
      "add-generic-password",
      "-U",
      "-s",
      service,
      "-a",
      account,
      "-w",
      secret,
    ]);
    if (r.code !== 0) {
      throw new Error(`security add-generic-password failed (code ${r.code})`);
    }
  }

  async delete(service: string, account: string): Promise<boolean> {
    const r = await this._exec("security", [
      "delete-generic-password",
      "-s",
      service,
      "-a",
      account,
    ]);
    return r.code === 0;
  }

  async list(_service: string): Promise<readonly string[]> {
    // `security` cannot enumerate accounts for a service without an
    // interactive keychain dump; treat listing as unsupported here.
    return [];
  }
}

/** Linux secret store via `secret-tool` (libsecret). */
export class LinuxSecretToolBackend implements KeychainBackend {
  readonly name = "linux-secret-tool";
  constructor(private readonly _exec: KeychainExec = defaultKeychainExec) {}

  async isAvailable(): Promise<boolean> {
    const r = await this._exec("secret-tool", ["--help"]);
    return r.code === 0 || /secret-tool/i.test(r.stdout + r.stderr);
  }

  async get(service: string, account: string): Promise<string | null> {
    const r = await this._exec("secret-tool", [
      "lookup",
      "service",
      service,
      "account",
      account,
    ]);
    if (r.code !== 0) return null;
    const value = r.stdout.replace(/\r?\n$/, "");
    return value.length > 0 ? value : null;
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    // secret-tool reads the secret from stdin -- keeps it off the argv vector.
    const r = await this._exec(
      "secret-tool",
      [
        "store",
        "--label",
        `${service}/${account}`,
        "service",
        service,
        "account",
        account,
      ],
      secret,
    );
    if (r.code !== 0) {
      throw new Error(`secret-tool store failed (code ${r.code})`);
    }
  }

  async delete(service: string, account: string): Promise<boolean> {
    const r = await this._exec("secret-tool", [
      "clear",
      "service",
      service,
      "account",
      account,
    ]);
    return r.code === 0;
  }

  async list(service: string): Promise<readonly string[]> {
    const r = await this._exec("secret-tool", ["search", "--all", "service", service]);
    if (r.code !== 0) return [];
    const accounts: string[] = [];
    for (const line of r.stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*attribute\.account\s*=\s*(.+)$/);
      if (match && match[1]) accounts.push(match[1].trim());
    }
    return accounts;
  }
}

/** Windows Credential Manager via the WinRT `PasswordVault` from PowerShell. */
export class WindowsCredentialBackend implements KeychainBackend {
  readonly name = "windows-passwordvault";
  constructor(private readonly _exec: KeychainExec = defaultKeychainExec) {}

  private _ps(script: string, stdin?: string): Promise<KeychainExecResult> {
    return this._exec(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      stdin,
    );
  }

  private _vaultPrelude(): string {
    return "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];" +
      "$v = New-Object Windows.Security.Credentials.PasswordVault;";
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "win32") return false;
    const r = await this._ps(`${this._vaultPrelude()} 'ok'`);
    return r.code === 0 && /ok/.test(r.stdout);
  }

  async get(service: string, account: string): Promise<string | null> {
    const res = jsStringLiteral(service);
    const acc = jsStringLiteral(account);
    const r = await this._ps(
      `${this._vaultPrelude()} try { $c = $v.Retrieve(${res}, ${acc}); $c.RetrievePassword(); [Console]::Out.Write($c.Password) } catch { exit 1 }`,
    );
    if (r.code !== 0) return null;
    return r.stdout.length > 0 ? r.stdout : null;
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    const res = jsStringLiteral(service);
    const acc = jsStringLiteral(account);
    // Read the secret from stdin to keep it off the argv vector.
    const r = await this._ps(
      `${this._vaultPrelude()} $p = [Console]::In.ReadToEnd(); ` +
        `try { $old = $v.Retrieve(${res}, ${acc}); $v.Remove($old) } catch {} ` +
        `$v.Add((New-Object Windows.Security.Credentials.PasswordCredential(${res}, ${acc}, $p)))`,
      secret,
    );
    if (r.code !== 0) {
      throw new Error(`PasswordVault.Add failed (code ${r.code})`);
    }
  }

  async delete(service: string, account: string): Promise<boolean> {
    const res = jsStringLiteral(service);
    const acc = jsStringLiteral(account);
    const r = await this._ps(
      `${this._vaultPrelude()} try { $c = $v.Retrieve(${res}, ${acc}); $v.Remove($c) } catch { exit 1 }`,
    );
    return r.code === 0;
  }

  async list(service: string): Promise<readonly string[]> {
    const res = jsStringLiteral(service);
    const r = await this._ps(
      `${this._vaultPrelude()} try { $v.RetrieveAll() | Where-Object { $_.Resource -eq ${res} } | ForEach-Object { $_.UserName } } catch {}`,
    );
    if (r.code !== 0) return [];
    return r.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
}

/** Encode a string as a single-quoted PowerShell literal (doubles `'`). */
function jsStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface DetectKeychainBackendOptions {
  /** Override the detected platform (tests). */
  readonly platform?: NodeJS.Platform;
  /** Override the exec used by the CLI backends (tests). */
  readonly exec?: KeychainExec;
}

/**
 * Pick the keychain backend for the host platform. Returns the platform
 * backend regardless of whether the underlying tool is installed; callers use
 * {@link KeychainBackend.isAvailable} (via CredentialVault) to decide whether
 * to degrade with a clear error.
 */
export function detectKeychainBackend(
  opts: DetectKeychainBackendOptions = {},
): KeychainBackend {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultKeychainExec;
  switch (platform) {
    case "darwin":
      return new MacOsSecurityBackend(exec);
    case "win32":
      return new WindowsCredentialBackend(exec);
    case "linux":
      return new LinuxSecretToolBackend(exec);
    default:
      return new LinuxSecretToolBackend(exec);
  }
}
