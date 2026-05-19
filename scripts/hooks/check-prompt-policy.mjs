#!/usr/bin/env node
/**
 * UserPromptSubmit hook: scan the outgoing prompt for accidentally-pasted
 * secrets and block submission if any are found. Runs a curated subset of
 * the gitleaks public ruleset (~10 patterns) against the prompt body. All
 * patterns use bounded quantifiers to avoid catastrophic backtracking.
 *
 * Workspace-local override at `.nexus/prompt-policy.json` is additive
 * only: built-in patterns cannot be disabled. The override schema is:
 *
 *   {
 *     "extraPatterns": [
 *       { "name": "internal-token", "regex": "INT-[A-Z0-9]{20}" }
 *     ],
 *     "allowlist": ["AKIAIOSFODNN7EXAMPLE"]
 *   }
 *
 * Exit codes:
 *   0  - allowed
 *   2  - blocked (with `BLOCKED: <reason>` on stderr)
 *
 * Budget: < 50 ms p99 on a 64 KB prompt.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE_ROOT = process.env["GEMMA_HOOK_WORKSPACE_ROOT"] ?? process.cwd();
const OVERRIDE_PATH = join(WORKSPACE_ROOT, ".nexus", "prompt-policy.json");

// ---------------------------------------------------------------------------
// Built-in pattern library
// ---------------------------------------------------------------------------

/**
 * Each pattern uses bounded quantifiers (no nested quantifiers, no
 * unbounded `+` over alternations) to be ReDoS-resistant by construction.
 */
const BUILTIN_PATTERNS = Object.freeze([
  // Patterns are deliberately scoped to *developer secrets* a user might
  // paste by accident into a chat with the local model. Cloud-LLM-vendor
  // keys (Anthropic, OpenAI) and chat-platform tokens (Slack, etc.) are
  // out of scope: this is an offline-first single-GPU project that never
  // talks to those services, so flagging them in this hook would conflict
  // with the project's thesis. Workspace-local override is available for
  // teams whose workflow legitimately involves those credentials.
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub PAT", regex: /ghp_[A-Za-z0-9]{36}/ },
  {
    name: "JWT",
    regex: /eyJ[A-Za-z0-9_-]{10,400}\.eyJ[A-Za-z0-9_-]{10,800}\.[A-Za-z0-9_-]{10,400}/,
  },
  {
    name: "SSH private key header",
    regex: /-----BEGIN (RSA|OPENSSH|EC) PRIVATE KEY-----/,
  },
  { name: "PEM private key", regex: /-----BEGIN PRIVATE KEY-----/ },
  {
    name: "Generic high-entropy hex/base64 token",
    regex: /\b[A-Za-z0-9+/]{40,80}\b/,
  },
]);

// ---------------------------------------------------------------------------
// Workspace-local override loader
// ---------------------------------------------------------------------------

/**
 * Load the optional workspace-local override file. Returns
 * `{ extraPatterns, allowlist }`; on parse failure or missing file, returns
 * empty arrays. The override is additive: it can introduce new patterns and
 * allowlist specific match strings to suppress false positives. It cannot
 * disable any built-in pattern.
 *
 * For ReDoS safety, override regex strings are rejected if they contain a
 * nested quantifier sequence (e.g. `(a+)+`).
 */
function loadOverride() {
  const empty = { extraPatterns: [], allowlist: new Set() };
  if (!existsSync(OVERRIDE_PATH)) return empty;
  let raw;
  try {
    raw = readFileSync(OVERRIDE_PATH, "utf-8");
  } catch {
    return empty;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(
      `WARN: ${OVERRIDE_PATH} is not valid JSON; ignoring override\n`,
    );
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;

  const extraPatterns = [];
  const rawExtra = Array.isArray(parsed.extraPatterns) ? parsed.extraPatterns : [];
  for (const entry of rawExtra) {
    if (!entry || typeof entry !== "object") continue;
    const name = typeof entry.name === "string" ? entry.name : null;
    const regexSource = typeof entry.regex === "string" ? entry.regex : null;
    if (!name || !regexSource) continue;
    if (containsNestedQuantifier(regexSource)) {
      process.stderr.write(
        `WARN: rejecting override pattern '${name}': nested quantifier risk\n`,
      );
      continue;
    }
    try {
      extraPatterns.push({ name, regex: new RegExp(regexSource) });
    } catch {
      process.stderr.write(`WARN: rejecting override pattern '${name}': invalid regex\n`);
    }
  }

  const allowlist = new Set();
  const rawAllow = Array.isArray(parsed.allowlist) ? parsed.allowlist : [];
  for (const entry of rawAllow) {
    if (typeof entry === "string" && entry.length > 0) allowlist.add(entry);
  }

  return { extraPatterns, allowlist };
}

/**
 * Crude detection of a nested quantifier such as `(...)+` followed by another
 * `+` or `*`. Sufficient for rejecting the most common ReDoS shapes from a
 * user-supplied override.
 */
function containsNestedQuantifier(source) {
  return /\([^()]*[+*]\)[+*]/.test(source) || /\([^()]*\{[0-9,]+\}\)[+*{]/.test(source);
}

// ---------------------------------------------------------------------------
// Stdin parsing
// ---------------------------------------------------------------------------

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract the prompt body from the harness payload. Accepts either:
 *   { prompt: string }                        // generic harness shape
 *   { user_prompt: string }                   // alternative
 *   { messages: [{ role, content }] }         // OpenAI/Anthropic style
 * Returns "" on any malformed input; the hook treats empty input as allowed.
 */
function extractPrompt(raw) {
  if (!raw || raw.trim() === "") return "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") return "";
  if (typeof parsed.prompt === "string") return parsed.prompt;
  if (typeof parsed.user_prompt === "string") return parsed.user_prompt;
  if (typeof parsed.input === "string") return parsed.input;
  if (Array.isArray(parsed.messages)) {
    return parsed.messages
      .map((m) => (m && typeof m.content === "string" ? m.content : ""))
      .join("\n");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * v0.8.0 Phase 5 sub-task 5.6 (item G6) -- detect the stdin-JSON protocol.
 * When the harness sends `{ event, ... }` JSON, emit a JSON decision document
 * to stdout and exit 0 instead of using exit-code 2.
 */
let _protocol = "exit-code";

function detectProtocol(raw) {
  if (!raw || raw.trim() === "") return "exit-code";
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj["event"] === "string") {
      return "stdin-decision";
    }
  } catch {
    // not JSON - legacy
  }
  return "exit-code";
}

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

function main() {
  const raw = readStdinSync();
  _protocol = detectProtocol(raw);
  const prompt = extractPrompt(raw);
  if (prompt === "") {
    allow();
    return;
  }

  const override = loadOverride();
  const allPatterns = [...BUILTIN_PATTERNS, ...override.extraPatterns];

  for (const { name, regex } of allPatterns) {
    const match = prompt.match(regex);
    if (!match) continue;
    if (override.allowlist.has(match[0])) continue;
    block(
      `prompt contains a likely ${name}; remove or obfuscate before submitting`,
    );
  }

  allow();
}

main();
