#!/usr/bin/env node
/**
 * PreToolUse hook: agent-agnostic defense-in-depth check for Bash / Write / Edit
 * tool calls.
 *
 * Two interchangeable I/O protocols are supported (v0.8.0 Phase 5 sub-task 5.6,
 * item G6):
 *
 *  1. **Exit-code protocol (legacy)**: read JSON `{ tool_name, tool_input }`
 *     from stdin, exit 0 to allow, exit 2 with `BLOCKED: <reason>` on stderr
 *     to deny. This is the v0.7.0 contract and remains the default.
 *
 *  2. **stdin-JSON / stdout-decision protocol (new)**: when the stdin payload
 *     also includes an `"event"` field (e.g. `{ event: "PreToolUse", tool, args,
 *     peer, sessionId }`), the hook writes a JSON decision document to stdout
 *     (`{"decision":"allow"}` or `{"decision":"block","reason":"..."}`) and
 *     exits 0 in both cases. The legacy `tool_name` / `tool_input` field
 *     names are accepted as aliases for `tool` / `args` so the same payload
 *     can drive either protocol.
 *
 * The script is invoked by the agent's harness layer (Claude Code, Cursor, husky,
 * any other tool); see `docs/harness-integration.md` for example wirings.
 *
 * Budget: < 50 ms wall-clock. No SQLite, no large file reads, no network.
 *
 * Exit codes:
 *   0  - allowed (exit-code protocol) or decision emitted (new protocol)
 *   2  - blocked (exit-code protocol only; new protocol always exits 0)
 *   1  - script error (malformed payload, internal failure)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, isAbsolute, relative, sep, join, dirname } from "node:path";
import { matchesSecretPath } from "./lib/secret-paths.mjs";

const CONSENT_FILE =
  process.env["GEMMA_HOOK_CONSENT_FILE"] ??
  join(homedir(), ".nexus", "hooks-consent.json");

function recordConsentIfNeeded(sessionId) {
  if (!sessionId) return;
  try {
    let payload = { version: 1, sessions: {} };
    if (existsSync(CONSENT_FILE)) {
      try {
        const raw = readFileSync(CONSENT_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed["sessions"]) {
          payload = parsed;
        }
      } catch {
        // fall through to fresh payload
      }
    }
    if (!payload.sessions[sessionId]) {
      payload.sessions[sessionId] = { firstSeenAt: new Date().toISOString() };
      mkdirSync(dirname(CONSENT_FILE), { recursive: true });
      writeFileSync(CONSENT_FILE, JSON.stringify(payload, null, 2), "utf-8");
    }
  } catch {
    // Consent recording is best-effort; never break the hook on a write failure.
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = process.env["GEMMA_HOOK_WORKSPACE_ROOT"] ?? process.cwd();

/**
 * Read the entire stdin synchronously into a string.
 * Returns empty string if no data is piped (e.g. interactive invocation).
 */
function readStdinSync() {
  try {
    const data = readFileSync(0, "utf-8");
    return data;
  } catch {
    return "";
  }
}

/**
 * Parse the harness event payload. Supports both protocols:
 *   - Exit-code (legacy): `{ tool_name, tool_input }`
 *   - stdin-JSON (new):  `{ event, tool, args, peer, sessionId }`
 * Returns `{ toolName, toolInput, protocol, event, sessionId, peer }` on
 * success, or null when malformed.
 */
function parsePayload(raw) {
  if (!raw || raw.trim() === "") return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const toolName =
      typeof obj["tool_name"] === "string"
        ? obj["tool_name"]
        : typeof obj["tool"] === "string"
        ? obj["tool"]
        : null;
    const toolInput =
      obj["tool_input"] && typeof obj["tool_input"] === "object"
        ? obj["tool_input"]
        : obj["args"] && typeof obj["args"] === "object"
        ? obj["args"]
        : obj["parameters"] && typeof obj["parameters"] === "object"
        ? obj["parameters"]
        : {};
    if (!toolName) return null;
    const event = typeof obj["event"] === "string" ? obj["event"] : null;
    const sessionId = typeof obj["sessionId"] === "string" ? obj["sessionId"] : null;
    const peer = typeof obj["peer"] === "string" ? obj["peer"] : null;
    const protocol = event !== null ? "stdin-decision" : "exit-code";
    return { toolName, toolInput, protocol, event, sessionId, peer };
  } catch {
    return null;
  }
}

// `_protocol` is captured at parse time and forwarded into block/allow so the
// pair of helpers can switch on whether to print stdout JSON or rely on exit
// codes. Default to the legacy contract when an entry point forgets to set it.
let _protocol = "exit-code";

function block(reason) {
  if (_protocol === "stdin-decision") {
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
    process.exit(0);
  }
  process.stderr.write(`BLOCKED: ${reason}\n`);
  process.exit(2);
}

function allow() {
  if (_protocol === "stdin-decision") {
    process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Convert a (possibly absolute) path to a workspace-relative posix-style path.
 * Returns null if the path escapes the workspace root.
 */
function toWorkspaceRelative(p) {
  if (typeof p !== "string" || p.length === 0) return null;
  const absolute = isAbsolute(p) ? p : resolve(WORKSPACE_ROOT, p);
  const rel = relative(WORKSPACE_ROOT, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function checkFilePath(label, rawPath) {
  const rel = toWorkspaceRelative(rawPath);
  if (rel === null) {
    block(`${label} target is outside the workspace root: ${String(rawPath)}`);
  }
  if (matchesSecretPath(rel)) {
    block(`${label} target matches the secret-path denylist: ${rel}`);
  }
}

// ---------------------------------------------------------------------------
// Bash command parsing
// ---------------------------------------------------------------------------

/**
 * Extract candidate path arguments from a Bash command string. The parser is
 * intentionally permissive: it splits on whitespace honouring single and
 * double quotes, then keeps tokens that look like filesystem paths (contain
 * `/`, `\`, or a leading `.`). False positives are acceptable; the goal is
 * defence-in-depth so over-blocking is preferable to under-blocking on the
 * narrow secret-path patterns.
 */
function extractBashPaths(command) {
  if (typeof command !== "string" || command.length === 0) return [];
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        current += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === ";" || c === "|" || c === "&") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += c;
  }
  if (current.length > 0) tokens.push(current);

  return tokens.filter((t) => {
    if (t.length === 0) return false;
    if (t.startsWith("-")) return false;
    return t.includes("/") || t.includes("\\") || t.startsWith(".");
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const raw = readStdinSync();
  const payload = parsePayload(raw);
  if (!payload) {
    allow();
    return;
  }
  _protocol = payload.protocol;
  recordConsentIfNeeded(payload.sessionId);
  const { toolName, toolInput } = payload;

  if (toolName === "Bash" || toolName === "bash" || toolName === "run_terminal") {
    const command = toolInput["command"] ?? toolInput["cmd"] ?? "";
    const paths = extractBashPaths(typeof command === "string" ? command : "");
    for (const p of paths) {
      const rel = toWorkspaceRelative(p);
      if (rel !== null && matchesSecretPath(rel)) {
        block(`Bash command references a secret path: ${rel}`);
      }
    }
    allow();
    return;
  }

  if (toolName === "Write" || toolName === "write_file" || toolName === "create_file") {
    const filePath =
      toolInput["file_path"] ?? toolInput["path"] ?? toolInput["filename"];
    checkFilePath("Write", filePath);
    allow();
    return;
  }

  if (toolName === "Edit" || toolName === "edit_file" || toolName === "MultiEdit") {
    const filePath =
      toolInput["file_path"] ?? toolInput["path"] ?? toolInput["filename"];
    checkFilePath("Edit", filePath);
    allow();
    return;
  }

  allow();
}

main();
