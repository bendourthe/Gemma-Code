#!/usr/bin/env node
/**
 * PreToolUse hook: agent-agnostic defense-in-depth check for Bash / Write / Edit
 * tool calls. Reads a JSON event payload from stdin (`{ tool_name, tool_input }`),
 * exits 0 to allow, exits 2 with `BLOCKED: <reason>` on stderr to deny.
 *
 * The script is invoked by the agent's harness layer (Claude Code, Cursor, husky,
 * any other tool); see `docs/harness-integration.md` for example wirings.
 *
 * Budget: < 50 ms wall-clock. No SQLite, no large file reads, no network.
 *
 * Exit codes:
 *   0  - allowed
 *   2  - blocked (with `BLOCKED: <reason>` on stderr)
 *   1  - script error (malformed payload, internal failure)
 */

import { readFileSync } from "node:fs";
import { resolve, isAbsolute, relative, sep } from "node:path";
import { matchesSecretPath } from "./lib/secret-paths.mjs";

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
 * Parse the harness event payload. Expected shape:
 *   { tool_name: string; tool_input: Record<string, unknown> }
 * Returns null on malformed input.
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
        : obj["parameters"] && typeof obj["parameters"] === "object"
        ? obj["parameters"]
        : {};
    if (!toolName) return null;
    return { toolName, toolInput };
  } catch {
    return null;
  }
}

function block(reason) {
  process.stderr.write(`BLOCKED: ${reason}\n`);
  process.exit(2);
}

function allow() {
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
