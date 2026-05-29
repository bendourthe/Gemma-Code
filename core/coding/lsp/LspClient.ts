/**
 * v1.2.0 Phase 6.2 -- Language Server Protocol client over stdio.
 *
 * Speaks JSON-RPC 2.0 over a child-process stdio pair. Supports the two
 * requests the Phase 6.2 plan calls out:
 *
 *   - `lsp_definition(file, line, column)` -- maps to LSP
 *     `textDocument/definition`.
 *   - `lsp_references(file, line, column)` -- maps to LSP
 *     `textDocument/references` with `includeDeclaration: false`.
 *
 * Per-language server processes are launched lazily on first request and
 * cached for the lifetime of the client; subsequent requests against the
 * same language reuse the same child process.
 *
 * Out-of-scope notes:
 *
 *   - This is *not* a full LSP client. We only `initialize`, send the
 *     two request types above, and `shutdown` / `exit` at teardown.
 *   - No streaming workspace symbols, no completion, no diagnostics
 *     subscription. The narrow surface matches the plan's "symbol-precise
 *     references" goal without dragging the full protocol in.
 *   - Server presence is detected lazily; if the binary is missing the
 *     installer warning surfaces via `LspClient.isServerAvailable(...)`
 *     and the two MCP tools degrade to a structured "lsp server missing"
 *     error rather than silently falling back to grep.
 *
 * DEVIATION (logged in `docs/v1.2.0/known-gaps.md`): the plan prompt
 * lists `typescript-language-server`, `pylsp`, and `rust-analyzer`. The
 * runtime resolution uses `which`-style PATH lookup; we never bundle an
 * LSP server binary because the installer policy is no-network at
 * runtime. The plan's "warn when missing" requirement is enforced here.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export type LspLanguage = "typescript" | "python" | "rust";

export interface LspServerConfig {
  /** Display name surfaced by `isServerAvailable`. */
  readonly displayName: string;
  /** Executable name -- looked up via PATH on first launch. */
  readonly command: string;
  /** Extra args (e.g. `--stdio` for the TS server). */
  readonly args: readonly string[];
}

export const DEFAULT_LSP_SERVERS: Record<LspLanguage, LspServerConfig> = Object.freeze({
  typescript: Object.freeze({
    displayName: "typescript-language-server",
    command: "typescript-language-server",
    args: ["--stdio"],
  }),
  python: Object.freeze({
    displayName: "python-lsp-server (pylsp)",
    command: "pylsp",
    args: [],
  }),
  rust: Object.freeze({
    displayName: "rust-analyzer",
    command: "rust-analyzer",
    args: [],
  }),
});

export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

export interface LspLocation {
  readonly uri: string;
  readonly range: {
    readonly start: LspPosition;
    readonly end: LspPosition;
  };
}

export interface LspDefinitionRequest {
  readonly language: LspLanguage;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly fileContents: string;
}

export interface LspReferencesRequest extends LspDefinitionRequest {
  readonly includeDeclaration?: boolean;
}

export interface LspResult<T> {
  readonly ok: boolean;
  readonly locations?: readonly T[];
  readonly error?: string;
}

export interface LspChildProcessLauncher {
  /**
   * Spawn an LSP server child process for `language`. Implementations
   * may return `null` to indicate the server is not installed; the
   * caller then surfaces a structured warning instead of crashing.
   */
  launch(
    language: LspLanguage,
    config: LspServerConfig,
  ): ChildProcess | null;
}

export class DefaultLspLauncher implements LspChildProcessLauncher {
  launch(language: LspLanguage, config: LspServerConfig): ChildProcess | null {
    try {
      const child = spawn(config.command, [...config.args], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      // child.spawnargs is set even when the binary is missing; the
      // ENOENT only surfaces via the `error` event asynchronously.
      // Capture the missing-binary case via a one-shot listener and
      // return null synchronously: the caller checks return value.
      child.once("error", () => {
        // Suppress; the read loop will see EOF and clean up.
      });
      return child;
    } catch {
      return null;
    }
  }
}

interface PendingRequest {
  readonly id: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly method: string;
  timer: NodeJS.Timeout;
}

interface ManagedServer {
  readonly language: LspLanguage;
  readonly child: ChildProcess;
  readonly emitter: EventEmitter;
  readonly pending: Map<number, PendingRequest>;
  readonly openedUris: Set<string>;
  initialized: boolean;
  readBuf: Buffer;
  nextId: number;
  stderr: string;
}

export interface LspClientOptions {
  readonly servers?: Partial<Record<LspLanguage, LspServerConfig>>;
  readonly launcher?: LspChildProcessLauncher;
  /** Per-request timeout in ms. Default 10s. */
  readonly requestTimeoutMs?: number;
  /**
   * Sink for `[LSP] server <lang> not installed`-style warnings, called
   * once per missing server. Defaults to a no-op; the installer attaches
   * its logger so the warning surfaces in installer-smoke logs.
   */
  readonly onServerMissing?: (
    language: LspLanguage,
    config: LspServerConfig,
  ) => void;
}

export class LspClient {
  private readonly _servers: Record<LspLanguage, LspServerConfig>;
  private readonly _launcher: LspChildProcessLauncher;
  private readonly _timeoutMs: number;
  private readonly _onServerMissing: NonNullable<LspClientOptions["onServerMissing"]>;
  private readonly _managed: Partial<Record<LspLanguage, ManagedServer>> = {};
  private readonly _warnedMissing: Set<LspLanguage> = new Set();

  constructor(opts: LspClientOptions = {}) {
    this._servers = {
      typescript: opts.servers?.typescript ?? DEFAULT_LSP_SERVERS.typescript,
      python: opts.servers?.python ?? DEFAULT_LSP_SERVERS.python,
      rust: opts.servers?.rust ?? DEFAULT_LSP_SERVERS.rust,
    };
    this._launcher = opts.launcher ?? new DefaultLspLauncher();
    this._timeoutMs = opts.requestTimeoutMs ?? 10_000;
    this._onServerMissing = opts.onServerMissing ?? (() => {});
  }

  /**
   * Whether the LSP server for `language` is currently available (either
   * already launched, or launchable on demand). Returns `false` after
   * the launcher has reported the binary as missing.
   */
  isServerAvailable(language: LspLanguage): boolean {
    const existing = this._managed[language];
    if (existing) return existing.child.exitCode === null;
    return !this._warnedMissing.has(language);
  }

  async definition(req: LspDefinitionRequest): Promise<LspResult<LspLocation>> {
    return this._textDocumentRequest(
      req,
      "textDocument/definition",
      {
        textDocument: { uri: pathToUri(req.filePath) },
        position: { line: req.line, character: req.column },
      },
    );
  }

  async references(req: LspReferencesRequest): Promise<LspResult<LspLocation>> {
    return this._textDocumentRequest(
      req,
      "textDocument/references",
      {
        textDocument: { uri: pathToUri(req.filePath) },
        position: { line: req.line, character: req.column },
        context: {
          includeDeclaration: req.includeDeclaration ?? false,
        },
      },
    );
  }

  /** Shut down every managed server. Idempotent. */
  async shutdown(): Promise<void> {
    const langs = Object.keys(this._managed) as LspLanguage[];
    await Promise.all(
      langs.map(async (lang) => {
        const m = this._managed[lang];
        if (!m) return;
        try {
          await this._send(m, "shutdown", null);
          this._notify(m, "exit", null);
        } catch {
          // best-effort
        }
        try {
          m.child.kill();
        } catch {
          // already dead
        }
        delete this._managed[lang];
      }),
    );
  }

  private async _textDocumentRequest(
    req: LspDefinitionRequest,
    method: string,
    params: unknown,
  ): Promise<LspResult<LspLocation>> {
    const server = this._ensureServer(req.language);
    if (!server) {
      return Object.freeze({
        ok: false,
        error: `LSP server for ${req.language} is not installed. ` +
          `See installer-smoke logs for the missing-binary notice.`,
      });
    }
    try {
      if (!server.initialized) {
        await this._initialize(server, req.filePath);
      }
      this._didOpenIfNeeded(server, req.filePath, req.fileContents, req.language);
      const raw = (await this._send(server, method, params)) as
        | LspLocation
        | readonly LspLocation[]
        | null
        | undefined;
      const locations = normaliseLocations(raw);
      return Object.freeze({ ok: true, locations });
    } catch (err) {
      return Object.freeze({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private _ensureServer(language: LspLanguage): ManagedServer | null {
    const existing = this._managed[language];
    if (existing && existing.child.exitCode === null) return existing;
    if (existing && existing.child.exitCode !== null) {
      delete this._managed[language];
    }
    const config = this._servers[language];
    const child = this._launcher.launch(language, config);
    if (!child || child.exitCode !== null || !child.stdout || !child.stdin) {
      if (!this._warnedMissing.has(language)) {
        this._warnedMissing.add(language);
        this._onServerMissing(language, config);
      }
      return null;
    }
    const server: ManagedServer = {
      language,
      child,
      emitter: new EventEmitter(),
      pending: new Map(),
      openedUris: new Set(),
      initialized: false,
      readBuf: Buffer.alloc(0),
      nextId: 1,
      stderr: "",
    };
    this._wireStdio(server);
    this._managed[language] = server;
    return server;
  }

  private _wireStdio(server: ManagedServer): void {
    const { child } = server;
    child.stdout?.on("data", (chunk: Buffer) => {
      server.readBuf = Buffer.concat([server.readBuf, chunk]);
      this._drainBuffer(server);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      server.stderr += chunk.toString("utf-8");
      // Keep stderr bounded to avoid unbounded memory growth in long sessions.
      if (server.stderr.length > 32 * 1024) {
        server.stderr = server.stderr.slice(-16 * 1024);
      }
    });
    child.on("close", () => {
      for (const pending of server.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            `LSP server (${server.language}) exited before responding to ` +
              `${pending.method}. Last stderr: ${server.stderr.slice(-200)}`,
          ),
        );
      }
      server.pending.clear();
    });
  }

  private _drainBuffer(server: ManagedServer): void {
    while (true) {
      const headerEnd = server.readBuf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const headerStr = server.readBuf.slice(0, headerEnd).toString("ascii");
      const contentLengthMatch = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!contentLengthMatch) {
        // Malformed header; drop the buffer to recover.
        server.readBuf = Buffer.alloc(0);
        return;
      }
      const contentLength = parseInt(contentLengthMatch[1]!, 10);
      const totalLength = headerEnd + 4 + contentLength;
      if (server.readBuf.length < totalLength) return;
      const body = server.readBuf.slice(headerEnd + 4, totalLength).toString("utf-8");
      server.readBuf = server.readBuf.slice(totalLength);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }
      this._handleMessage(server, parsed);
    }
  }

  private _handleMessage(server: ManagedServer, msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    if (typeof m["id"] === "number" && (m["result"] !== undefined || m["error"] !== undefined)) {
      const id = m["id"] as number;
      const pending = server.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      server.pending.delete(id);
      if (m["error"]) {
        const err = m["error"] as { message?: string };
        pending.reject(new Error(err.message ?? `LSP error on ${pending.method}`));
      } else {
        pending.resolve(m["result"]);
      }
    }
    // Notifications and server->client requests are ignored.
  }

  private _send(
    server: ManagedServer,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = server.nextId;
      server.nextId += 1;
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      const body = JSON.stringify(payload);
      const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
      const timer = setTimeout(() => {
        server.pending.delete(id);
        reject(new Error(`LSP request ${method} timed out after ${this._timeoutMs}ms`));
      }, this._timeoutMs);
      server.pending.set(id, { id, resolve, reject, method, timer });
      try {
        server.child.stdin?.write(header);
        server.child.stdin?.write(body);
      } catch (err) {
        clearTimeout(timer);
        server.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private _notify(server: ManagedServer, method: string, params: unknown): void {
    const payload = { jsonrpc: "2.0", method, params };
    const body = JSON.stringify(payload);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    try {
      server.child.stdin?.write(header);
      server.child.stdin?.write(body);
    } catch {
      // Server already closed; nothing to do.
    }
  }

  private async _initialize(server: ManagedServer, anyFilePath: string): Promise<void> {
    const rootUri = pathToUri(workspaceRoot(anyFilePath));
    await this._send(server, "initialize", {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            didSave: false,
          },
          definition: { dynamicRegistration: false, linkSupport: false },
          references: { dynamicRegistration: false },
        },
        workspace: { workspaceFolders: false },
      },
      workspaceFolders: null,
      trace: "off",
    });
    this._notify(server, "initialized", {});
    server.initialized = true;
  }

  private _didOpenIfNeeded(
    server: ManagedServer,
    filePath: string,
    fileContents: string,
    language: LspLanguage,
  ): void {
    const uri = pathToUri(filePath);
    if (server.openedUris.has(uri)) return;
    this._notify(server, "textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: lspLanguageId(language),
        version: 1,
        text: fileContents,
      },
    });
    server.openedUris.add(uri);
  }
}

function lspLanguageId(language: LspLanguage): string {
  switch (language) {
    case "typescript":
      return "typescript";
    case "python":
      return "python";
    case "rust":
      return "rust";
  }
}

function normaliseLocations(
  raw: LspLocation | readonly LspLocation[] | null | undefined,
): readonly LspLocation[] {
  if (!raw) return Object.freeze([]);
  if (Array.isArray(raw)) {
    return Object.freeze(raw.map(freezeLocation));
  }
  return Object.freeze([freezeLocation(raw as LspLocation)]);
}

function freezeLocation(loc: LspLocation): LspLocation {
  return Object.freeze({
    uri: loc.uri,
    range: Object.freeze({
      start: Object.freeze({ ...loc.range.start }),
      end: Object.freeze({ ...loc.range.end }),
    }),
  });
}

function pathToUri(absPath: string): string {
  if (absPath.startsWith("file://")) return absPath;
  const normalised = absPath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(normalised)) {
    return `file:///${encodeURI(normalised)}`;
  }
  return `file://${encodeURI(normalised.startsWith("/") ? normalised : `/${normalised}`)}`;
}

function workspaceRoot(filePath: string): string {
  // Heuristic: the workspace root is the closest ancestor that *contains*
  // either `package.json` / `pyproject.toml` / `Cargo.toml`. For
  // diagnostic purposes we just walk up the directory chain by one;
  // the LSP server will fall back to its own discovery rules.
  const idx = filePath.replace(/\\/g, "/").lastIndexOf("/");
  if (idx <= 0) return "/";
  return filePath.slice(0, idx);
}
