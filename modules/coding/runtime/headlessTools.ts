// ---------------------------------------------------------------------------
// v1.7.0 headless agent runtime (root fix for SO001.P1.A / the deferred
// NexusCodingRuntime): vscode-free tool handlers scoped to a single working
// directory.
//
// The shipping VS Code tool handlers (`src/tools/handlers/*`) do all file I/O
// through `vscode.workspace.fs` + `vscode.Uri` and read `vscode.workspace`
// config, so they cannot load in a plain-Node host (the desktop sidecar, the
// `nexus` CLI, or the golden-task optimizer rollout). This module is the
// vscode-free counterpart: pure `node:fs` / `node:child_process` handlers that
// operate on an injected `workdir`, refusing any path that escapes it
// (fail-closed, mirroring `pathGuard.resolveInsideWorkspace` + the skill
// optimizer's `RootSkillPathResolver`). The shipping handlers are left
// untouched -- this is an additive, headless-only tool surface.
//
// Tool names match the canonical `ToolName` vocabulary so the vscode-free
// `Gemma4ToolFormat.parseToolCalls` accepts the model's calls unchanged.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { redactSecrets } from "../../../core/observability/redactSecrets.js";
import { classifyEditApply, noopEditMessage } from "../../../src/tools/handlers/editNoop.js";
import { nearMissToken } from "../../../src/tools/handlers/nearMiss.js";
import {
  type HeadlessGuardOptions,
  screenHeadlessCall,
} from "./headlessGuards.js";
import { createHeadlessBrowserTools } from "../browser/headless.js";
import type { BrowserDriver } from "../browser/types.js";
import {
  deriveDefaultPolicy,
  isExecSandboxEnabled,
  spawnSandboxed,
} from "../sandbox/index.js";

/** Max bytes returned to the model from a single read / terminal capture. */
export const HEADLESS_OUTPUT_BYTE_CAP = 64 * 1024;

/** Per-command wall-clock ceiling for `run_terminal` when the caller sets none. */
export const HEADLESS_TERMINAL_TIMEOUT_MS = 120_000;

export interface HeadlessToolContext {
  /** Absolute primary root. Relative paths and the default terminal cwd use it. */
  readonly workdir: string;
  /** Immutable selected-root snapshot. Defaults to [workdir] for compatibility. */
  readonly workspaceRoots?: readonly string[];
  readonly workspaceId?: string;
  /** Aborted when the per-task budget elapses; cooperative tools should stop. */
  readonly signal?: AbortSignal;
}

export interface HeadlessToolResult {
  readonly success: boolean;
  readonly output: string;
  readonly error?: string;
}

export interface HeadlessToolParam {
  readonly type: string;
  readonly description: string;
  readonly required?: boolean;
}

export interface HeadlessTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, HeadlessToolParam>>;
  execute(
    args: Readonly<Record<string, unknown>>,
    ctx: HeadlessToolContext,
  ): Promise<HeadlessToolResult>;
}

/** Injected terminal executor so tests never spawn a real process. */
export interface HeadlessExecOutcome {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
export type HeadlessExec = (
  command: string,
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  workspaceRoots?: readonly string[],
) => Promise<HeadlessExecOutcome>;

/**
 * v1.16.0 Phase 4 (adoption item A6) -- document parser for `parse_document`.
 * Takes base64 (never a path) so the TOOL owns path resolution and the guards.
 */
export interface HeadlessDocumentParser {
  parse(
    documentBase64: string,
    opts?: { readonly maxPages?: number },
  ): Promise<{
    readonly engine: string;
    readonly text: string;
    readonly markdown: string | null;
    readonly pageCount: number;
  }>;
}

export interface HeadlessToolOptions {
  /** Override the terminal executor (tests inject a deterministic fake). */
  readonly exec?: HeadlessExec;
  /** Override the output byte cap (tests). */
  readonly byteCap?: number;
  /**
   * v1.16.0 Phase 4 (A6): security guards applied to EVERY headless tool call.
   * Omit and the surface behaves as it did before v1.16.0 for AUTO_APPROVE
   * tools, while CONFIRM-and-above tools are refused (fail-closed) because a
   * headless host has no user to prompt.
   */
  readonly guards?: HeadlessGuardOptions;
  /**
   * v1.16.0 Phase 4 (A6) / v1.20.0 Phase 1 (A1): document-OCR parser. Omit and
   * `parse_document` is not registered. Sidecar ACP/scheduler/coding hosts
   * supply this through `createSidecarHeadlessTools` when the flag is on.
   */
  readonly documentParser?: HeadlessDocumentParser;
  /**
   * v1.20.0 Phase 1 (A1): when false, `parse_document` is not registered even
   * if `documentParser` is present. Flag wins over presence. Default is
   * "register if a parser was supplied" so existing tests keep working.
   */
  readonly parseDocumentEnabled?: boolean;
  /**
   * v1.18.0 Phase 6 (OI-A1): wrap the default `run_terminal` exec in the OS
   * sandbox. `NEXUS_EXEC_SANDBOX` still overrides. Injected `exec` is unchanged
   * so tests keep a fake process.
   */
  readonly execSandbox?: boolean;
  /**
   * v2.0.0 Phase 2: isolated-profile browser tools. Off by default so the
   * canonical file-tool list stays unchanged; the sidecar coding host opts in.
   */
  readonly browserEnabled?: boolean;
  /** Injected driver (tests). Production uses InMemory under Vitest, Playwright otherwise. */
  readonly browserDriver?: BrowserDriver;
  /**
   * v1.20 DF-1 -- optional memory writer for parse_document ingest. Sidecar
   * uses an in-process store (not a second SQLite).
   */
  readonly ingestToMemory?: (input: {
    text: string;
    sourcePath: string;
    engine: string;
    workspaceId?: string;
  }) => Promise<{ stored: boolean; reason?: string }>;
}

/** Upper bound on pages per call, mirroring the VS Code tool. */
export const HEADLESS_PARSE_MAX_PAGES = 50;

// --- path containment (fail-closed) ---------------------------------------

/** Real-path a path through its nearest existing ancestor (non-existent leaves ok). */
function realThroughAncestor(absolute: string): string {
  let current = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve `relOrAbs` against `workdir` and refuse anything that escapes it.
 * Throws on a traversal attempt (fail-closed) so a tool can only ever touch a
 * file inside the sandboxed working copy.
 */
export function resolveInsideWorkdir(workdir: string, relOrAbs: string): string {
  return resolveInsideWorkspaceRoots(workdir, [workdir], relOrAbs);
}

export function resolveInsideWorkspaceRoots(
  primaryRoot: string,
  workspaceRoots: readonly string[],
  relOrAbs: string,
): string {
  if (typeof relOrAbs !== "string" || relOrAbs.length === 0) {
    throw new Error("path argument is required.");
  }
  const roots = workspaceRoots.length ? workspaceRoots : [primaryRoot];
  const rootReals = roots.map((root) => realThroughAncestor(path.resolve(root)));
  const primaryReal = realThroughAncestor(path.resolve(primaryRoot));
  const absolute = path.isAbsolute(relOrAbs)
    ? relOrAbs
    : path.resolve(primaryReal, relOrAbs);
  const real = realThroughAncestor(absolute);
  const inside = rootReals.some((root) => real === root || real.startsWith(root + path.sep));
  if (!inside) {
    throw new Error(`path "${relOrAbs}" resolves outside the selected workspace roots.`);
  }
  return real;
}

function resolveForContext(ctx: HeadlessToolContext, relOrAbs: string): string {
  return resolveInsideWorkspaceRoots(ctx.workdir, ctx.workspaceRoots ?? [ctx.workdir], relOrAbs);
}

// --- helpers ---------------------------------------------------------------

function asString(args: Readonly<Record<string, unknown>>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") {
    throw new Error(`missing or non-string argument "${key}".`);
  }
  return v;
}

function optString(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

/** Normalize a path to forward slashes so tool output is stable across OSes. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function capBytes(text: string, cap: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= cap) return text;
  return `${buf.subarray(0, cap).toString("utf8")}\n... [truncated ${buf.length - cap} bytes]`;
}

function ok(output: string): HeadlessToolResult {
  return { success: true, output };
}
function fail(error: string): HeadlessToolResult {
  return { success: false, output: "", error };
}

/** Default terminal executor: spawn through the OS sandbox abstraction. */
function createDefaultExec(enabled: boolean): HeadlessExec {
  return (command, cwd, signal, timeoutMs, workspaceRoots = [cwd]) =>
    new Promise<HeadlessExecOutcome>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const { child, report } = spawnSandboxed({
        command,
        cwd,
        env: process.env,
        signal,
        enabled,
        policy: deriveDefaultPolicy(cwd, {
          extraWritableRoots: workspaceRoots.filter((root) => path.resolve(root) !== path.resolve(cwd)),
        }),
      });
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill();
          resolve({
            code: null,
            stdout,
            stderr: `${stderr}\n[timed out after ${timeoutMs}ms]\n[${report.summary}]`,
          });
        }
      }, timeoutMs);
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            code: null,
            stdout,
            stderr: `${stderr}${err.message}\n[${report.summary}]`,
          });
        }
      });
      child.on("close", (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const banner = `\n[${report.summary}]`;
          resolve({
            code,
            stdout,
            stderr: `${stderr}${banner}`,
          });
        }
      });
    });
}

// --- the tool set ----------------------------------------------------------

/**
 * Build the vscode-free headless tool set. Every handler resolves its path
 * inside `ctx.workdir` and fails closed on traversal. `run_terminal` runs
 * through the injected `exec` (default: a real shell scoped to `cwd`).
 */
export function createHeadlessTools(options: HeadlessToolOptions = {}): HeadlessTool[] {
  const exec = options.exec ?? createDefaultExec(isExecSandboxEnabled(options.execSandbox));
  const cap = options.byteCap ?? HEADLESS_OUTPUT_BYTE_CAP;

  const readFile: HeadlessTool = {
    name: "read_file",
    description: "Read the contents of a file relative to the working directory.",
    parameters: { path: { type: "string", description: "File path.", required: true } },
    async execute(args, ctx) {
      try {
        const abs = resolveForContext(ctx, asString(args, "path"));
        const content = await fsp.readFile(abs, "utf8");
        return ok(capBytes(content, cap));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const writeFile: HeadlessTool = {
    name: "write_file",
    description: "Write (overwrite) a file relative to the working directory.",
    parameters: {
      path: { type: "string", description: "File path.", required: true },
      content: { type: "string", description: "Full file contents.", required: true },
    },
    async execute(args, ctx) {
      try {
        const abs = resolveForContext(ctx, asString(args, "path"));
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, asString(args, "content"), "utf8");
        return ok(`wrote ${toPosix(path.relative(ctx.workdir, abs)) || path.basename(abs)}`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const createFile: HeadlessTool = {
    name: "create_file",
    description: "Create a new file. Fails if the file already exists.",
    parameters: {
      path: { type: "string", description: "File path.", required: true },
      content: { type: "string", description: "Full file contents.", required: true },
    },
    async execute(args, ctx) {
      try {
        const abs = resolveForContext(ctx, asString(args, "path"));
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, asString(args, "content"), { encoding: "utf8", flag: "wx" });
        return ok(`created ${toPosix(path.relative(ctx.workdir, abs)) || path.basename(abs)}`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const editFile: HeadlessTool = {
    name: "edit_file",
    description:
      "Replace the first occurrence of `old_text` with `new_text` in a file.",
    parameters: {
      path: { type: "string", description: "File path.", required: true },
      old_text: { type: "string", description: "Exact text to replace.", required: true },
      new_text: { type: "string", description: "Replacement text.", required: true },
    },
    async execute(args, ctx) {
      try {
        const abs = resolveForContext(ctx, asString(args, "path"));
        const oldText = asString(args, "old_text");
        const newText = asString(args, "new_text");
        const current = await fsp.readFile(abs, "utf8");
        const kind = classifyEditApply(current, oldText, newText);
        if (kind === "missing") return fail("old_text not found in file.");
        if (kind === "ambiguous") return fail("old_text appears more than once; pass more context.");
        if (kind === "noop") {
          return ok(noopEditMessage(toPosix(path.relative(ctx.workdir, abs)) || path.basename(abs)));
        }
        const next = current.slice(0, current.indexOf(oldText)) + newText + current.slice(current.indexOf(oldText) + oldText.length);
        await fsp.writeFile(abs, next, "utf8");
        return ok(`edited ${toPosix(path.relative(ctx.workdir, abs)) || path.basename(abs)}`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const deleteFile: HeadlessTool = {
    name: "delete_file",
    description: "Delete a file relative to the working directory.",
    parameters: { path: { type: "string", description: "File path.", required: true } },
    async execute(args, ctx) {
      try {
        const abs = resolveForContext(ctx, asString(args, "path"));
        await fsp.rm(abs, { force: false });
        return ok(`deleted ${toPosix(path.relative(ctx.workdir, abs)) || path.basename(abs)}`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const listDirectory: HeadlessTool = {
    name: "list_directory",
    description: "List entries in a directory relative to the working directory.",
    parameters: {
      path: { type: "string", description: "Directory path (defaults to the root).", required: false },
    },
    async execute(args, ctx) {
      try {
        const rel = optString(args, "path") ?? ".";
        const abs = resolveForContext(ctx, rel);
        const entries = await fsp.readdir(abs, { withFileTypes: true });
        const lines = entries
          .map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`)
          .sort();
        return ok(lines.join("\n") || "(empty)");
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const grep: HeadlessTool = {
    name: "grep_codebase",
    description: "Search files under the working directory for a literal substring.",
    parameters: {
      pattern: { type: "string", description: "Literal substring to search for.", required: true },
      path: { type: "string", description: "Sub-directory to search (defaults to root).", required: false },
    },
    async execute(args, ctx) {
      try {
        const pattern = asString(args, "pattern");
        const root = resolveForContext(ctx, optString(args, "path") ?? ".");
        const hits: string[] = [];
        const walk = async (dir: string): Promise<void> => {
          const entries = await fsp.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name === ".git" || e.name === "node_modules") continue;
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) {
              await walk(abs);
            } else if (e.isFile()) {
              let text: string;
              try {
                text = await fsp.readFile(abs, "utf8");
              } catch {
                continue;
              }
              const rel = toPosix(path.relative(ctx.workdir, abs));
              text.split(/\r?\n/).forEach((line, i) => {
                if (line.includes(pattern)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
              });
            }
            if (hits.length >= 200) return;
          }
        };
        await walk(root);
        if (hits.length) return ok(capBytes(hits.join("\n"), cap));
        const token = nearMissToken(pattern);
        if (token && token !== pattern) {
          const probes: string[] = [];
          const walkProbes = async (dir: string): Promise<void> => {
            const entries = await fsp.readdir(dir, { withFileTypes: true });
            for (const e of entries) {
              if (probes.length >= 5) return;
              const abs = path.join(dir, e.name);
              if (e.isDirectory()) {
                if (e.name === "node_modules" || e.name === ".git") continue;
                await walkProbes(abs);
              } else if (e.isFile()) {
                let text: string;
                try {
                  text = await fsp.readFile(abs, "utf8");
                } catch {
                  continue;
                }
                const rel = toPosix(path.relative(ctx.workdir, abs));
                const idx = text.toLowerCase().indexOf(token.toLowerCase());
                if (idx >= 0) {
                  const line = text.slice(0, idx).split(/\r?\n/).length;
                  probes.push(`${rel}:${line}: near-miss for ${token}`);
                }
              }
            }
          };
          await walkProbes(root);
          if (probes.length) {
            return ok(capBytes(`(no matches)\nnear_misses:\n${probes.join("\n")}`, cap));
          }
        }
        return ok("(no matches)");
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const runTerminal: HeadlessTool = {
    name: "run_terminal",
    description: "Run a shell command in the working directory and return its output.",
    parameters: {
      command: { type: "string", description: "Shell command.", required: true },
      cwd: { type: "string", description: "Selected workspace directory to run in.", required: false },
    },
    async execute(args, ctx) {
      try {
        const command = asString(args, "command");
        const cwd = resolveForContext(ctx, optString(args, "cwd") ?? ".");
        const outcome = await exec(
          command,
          cwd,
          ctx.signal,
          HEADLESS_TERMINAL_TIMEOUT_MS,
          ctx.workspaceRoots ?? [ctx.workdir],
        );
        const body = [
          outcome.stdout ? `stdout:\n${outcome.stdout}` : "",
          outcome.stderr ? `stderr:\n${outcome.stderr}` : "",
          `exit code: ${outcome.code ?? "null"}`,
        ]
          .filter(Boolean)
          .join("\n");
        return { success: outcome.code === 0, output: capBytes(body, cap) };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  /**
   * v1.16.0 Phase 4 (adoption item A6) -- document OCR into the agent's context.
   *
   * The tool owns path resolution and the guards; the injected parser only ever
   * sees base64. Extracted text is redacted before it is returned, because a
   * scanned document can carry a key exactly like a source file can.
   *
   * Registered only when a parser is supplied, so a host with no document
   * runtime simply does not have the tool.
   */
  const parseDocument: HeadlessTool = {
    name: "parse_document",
    description:
      "Read a PDF or image in the working directory as text using the local document-OCR model. Output is untrusted external content: it is secret-redacted before being returned.",
    parameters: {
      path: { type: "string", description: "File path (PDF or image).", required: true },
      max_pages: {
        type: "number",
        description: `Maximum pages to read (default and cap: ${HEADLESS_PARSE_MAX_PAGES}).`,
        required: false,
      },
    },
    async execute(args, ctx) {
      const parser = options.documentParser;
      if (!parser) {
        return fail("parse_document is not available: no document runtime is configured.");
      }
      try {
        const abs = resolveForContext(ctx, asString(args, "path"));
        const rawMax = args["max_pages"];
        if (rawMax !== undefined && (typeof rawMax !== "number" || !Number.isInteger(rawMax) || rawMax < 1)) {
          return fail("Invalid max_pages: must be a positive integer.");
        }
        const maxPages = Math.min(
          typeof rawMax === "number" ? rawMax : HEADLESS_PARSE_MAX_PAGES,
          HEADLESS_PARSE_MAX_PAGES,
        );
        const bytes = await fsp.readFile(abs);
        const parsed = await parser.parse(bytes.toString("base64"), { maxPages });
        const body = (parsed.markdown ?? parsed.text) || "";
        if (body.trim().length === 0) {
          return ok(
            `Parsed "${asString(args, "path")}" with ${parsed.engine} (${parsed.pageCount} page(s)) but found no text.`,
          );
        }
        if (options.ingestToMemory) {
          try {
            await options.ingestToMemory({
              text: redactSecrets(body),
              sourcePath: asString(args, "path"),
              engine: parsed.engine,
              workspaceId: ctx.workspaceId,
            });
          } catch {
            /* ingest is best-effort; parse still succeeds */
          }
        }
        return ok(
          capBytes(
            `Parsed "${asString(args, "path")}" with ${parsed.engine} (${parsed.pageCount} page(s)):\n\n` +
              redactSecrets(body),
            cap,
          ),
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const hashFile: HeadlessTool = {
    name: "hash_file",
    description: "SHA-256 of a file relative to the working directory.",
    parameters: { path: { type: "string", description: "File path.", required: true } },
    async execute(args, ctx) {
      try {
        const abs = resolveForContext(ctx, asString(args, "path"));
        const bytes = await fsp.readFile(abs);
        const hash = createHash("sha256").update(bytes).digest("hex");
        return ok(
          JSON.stringify({
            path: toPosix(path.relative(ctx.workdir, abs)) || path.basename(abs),
            algorithm: "sha256",
            hash,
            bytes: bytes.byteLength,
          }),
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const watchPath: HeadlessTool = {
    name: "watch_path",
    description: "Watch a path inside the working directory for a bounded interval.",
    parameters: {
      path: { type: "string", description: "File or directory path.", required: true },
      timeout_ms: { type: "number", description: "Wait at most this many ms (default 8000).", required: false },
    },
    async execute(args, ctx) {
      try {
        const abs = resolveForContext(ctx, asString(args, "path"));
        const rawTimeout = args["timeout_ms"];
        const timeoutMs =
          typeof rawTimeout === "number" && Number.isFinite(rawTimeout)
            ? Math.min(30_000, Math.max(50, Math.floor(rawTimeout)))
            : 8_000;
        const events: Array<{ type: string; filename: string | null }> = [];
        await new Promise<void>((resolve) => {
          let watcher: fs.FSWatcher;
          try {
            watcher = fs.watch(abs, { persistent: false }, (eventType, filename) => {
              events.push({ type: eventType, filename: filename === null ? null : String(filename) });
            });
          } catch (err) {
            events.push({ type: "error", filename: (err as Error).message });
            resolve();
            return;
          }
          const timer = setTimeout(() => {
            watcher.close();
            resolve();
          }, timeoutMs);
          watcher.on("error", (err) => {
            events.push({ type: "error", filename: err.message });
            clearTimeout(timer);
            watcher.close();
            resolve();
          });
        });
        return ok(JSON.stringify({ path: asString(args, "path"), timeout_ms: timeoutMs, events }));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const tools = [
    readFile,
    writeFile,
    createFile,
    editFile,
    deleteFile,
    listDirectory,
    grep,
    runTerminal,
    hashFile,
    watchPath,
    ...(options.documentParser && options.parseDocumentEnabled !== false ? [parseDocument] : []),
    ...(options.browserEnabled
      ? createHeadlessBrowserTools(
          options.browserDriver ? { driver: options.browserDriver } : undefined,
        )
      : []),
  ];

  // v1.16.0 Phase 4 (A6): wrap EVERY tool in the permission-tier + secret-path
  // screen. Applied here rather than inside each handler so a tool added later
  // cannot forget it, and so the headless surface stops being the weaker path
  // relative to the VS Code registry.
  return tools.map((tool) => withGuards(tool, options.guards));
}

/** Wrap a headless tool so its call is screened before `execute` runs. */
function withGuards(tool: HeadlessTool, guards: HeadlessGuardOptions | undefined): HeadlessTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async execute(args, ctx) {
      const decision = await screenHeadlessCall(tool.name, args, guards ?? {});
      if (!decision.allowed) {
        return { success: false, output: "", error: decision.reason ?? "refused" };
      }
      return tool.execute(args, ctx);
    },
  };
}
