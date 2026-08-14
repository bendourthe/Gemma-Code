#!/usr/bin/env node
/**
 * Safety-surface generator (v1.4.0 Phase 4, item A1).
 *
 * `nexus.security.toml` is the safety-config single source of truth (SSOT),
 * modeled on claude-code-harness `harness.toml` + `bin/harness sync`. This
 * script is the "sync" step: it regenerates every committed safety surface so
 * they cannot drift apart, and `--check` is the CI drift gate.
 *
 * Artifacts regenerated (each idempotent):
 *   1. The tool-permission-tier table in
 *      docs/archive/v0/v0.5/architecture.md, between the markers
 *        <!-- BEGIN:TOOL-PERMISSION-TABLE --> / <!-- END:TOOL-PERMISSION-TABLE -->
 *      Source: modules/coding/guardrails/permissionTierMap.ts (the canonical tier map;
 *      vscode-free so both the VS Code and headless surfaces share it).
 *   2. The [permissions] mirror block in nexus.security.toml, between the markers
 *        # BEGIN:GENERATED-PERMISSIONS / # END:GENERATED-PERMISSIONS
 *      Source: src/guardrails/PermissionTiers.ts. Per Section 13 of the
 *      claude-code-harness comparison, PermissionTiers.ts stays canonical (it
 *      binds tiers to the enum + clamp logic); the TOML carries a generated
 *      mirror so the SSOT is a complete one-page safety view.
 *   3. modules/coding/utils/generated/safetyConfig.generated.ts -- the egress
 *      denylist (A4) and secret-path denylist consumed by the runtime guards
 *      (ssrf.ts, secretPaths.ts). Source: the AUTHORED [network] / [secrets]
 *      sections of nexus.security.toml.
 *   4. The SECRET_PATH_PATTERNS array in scripts/hooks/lib/secret-paths.mjs (the
 *      agent-agnostic harness-hook copy), between the markers
 *        // BEGIN:GENERATED-SECRET-PATHS / // END:GENERATED-SECRET-PATHS
 *      Source: the AUTHORED [secrets] section of nexus.security.toml.
 *
 * Run via:
 *   npm run security:gen     (regenerate all surfaces in place)
 *   npm run security:check   (fail when any surface is out of sync; CI gate)
 *   npm run perm-tier        (alias: regenerate)
 *   npm run perm-tier:check  (alias: drift gate)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const ssotPath = path.join(repoRoot, "nexus.security.toml");
const permTiersPath = path.join(repoRoot, "modules/coding/guardrails/permissionTierMap.ts");
const docPath = path.join(repoRoot, "docs/archive/v0/v0.5/architecture.md");
const generatedTsPath = path.join(
  repoRoot,
  "modules/coding/utils/generated/safetyConfig.generated.ts",
);
const secretPathsMjsPath = path.join(repoRoot, "scripts/hooks/lib/secret-paths.mjs");

const docBeginMarker = "<!-- BEGIN:TOOL-PERMISSION-TABLE -->";
const docEndMarker = "<!-- END:TOOL-PERMISSION-TABLE -->";
const tomlPermBeginMarker = "# BEGIN:GENERATED-PERMISSIONS";
const tomlPermEndMarker = "# END:GENERATED-PERMISSIONS";
const mjsBeginMarker = "// BEGIN:GENERATED-SECRET-PATHS";
const mjsEndMarker = "// END:GENERATED-SECRET-PATHS";

const tierLabels = {
  0: { label: "0 -- auto", behavior: "Run silently" },
  1: { label: "1 -- confirm", behavior: "One-click confirmation" },
  2: {
    label: "2 -- dangerous",
    behavior: "Blocking confirmation; `editMode: plan` shows a diff",
  },
};
const tierEnumToNumber = {
  AUTO_APPROVE: 0,
  CONFIRM: 1,
  DANGEROUS: 2,
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parse TOOL_PERMISSION_MAP from PermissionTiers.ts into [{name, tier}]. */
export function parseToolMap(source) {
  const start = source.indexOf("TOOL_PERMISSION_MAP");
  if (start < 0) {
    throw new Error("TOOL_PERMISSION_MAP not found in permissionTierMap.ts");
  }
  const open = source.indexOf("{", start);
  const close = source.indexOf("};", open);
  if (open < 0 || close < 0) {
    throw new Error("Failed to locate TOOL_PERMISSION_MAP body");
  }
  const body = source.slice(open + 1, close);
  const entries = [];
  const re = /([a-z_]+):\s*PermissionTier\.([A-Z_]+)/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const tier = tierEnumToNumber[match[2]];
    if (tier === undefined) {
      throw new Error(`Unknown PermissionTier: ${match[2]}`);
    }
    entries.push({ name: match[1], tier });
  }
  if (entries.length === 0) {
    throw new Error("No tool entries parsed from TOOL_PERMISSION_MAP");
  }
  return entries;
}

/**
 * Read a TOML array-of-strings assigned to `key` (e.g. `egress_denylist`).
 * Handles multi-line arrays and `#` comments between entries (comments live
 * outside the double-quoted strings, so the string matcher skips them).
 * Constraint: array entries and the comments between them must not contain a
 * literal `]` (none of the safety patterns do).
 */
export function readTomlStringArray(text, key) {
  const re = new RegExp(`(?:^|\\n)[ \\t]*${key}[ \\t]*=[ \\t]*\\[`);
  const m = re.exec(text);
  if (!m) {
    throw new Error(`[generate] key "${key}" not found in nexus.security.toml`);
  }
  const openBracket = m.index + m[0].length - 1;
  const close = text.indexOf("]", openBracket);
  if (close < 0) {
    throw new Error(`[generate] unterminated array for "${key}"`);
  }
  const innerBody = text.slice(openBracket + 1, close);
  const items = [];
  const strRe = /"((?:[^"\\]|\\.)*)"/g;
  let sm;
  while ((sm = strRe.exec(innerBody)) !== null) {
    items.push(sm[1].replace(/\\(["\\])/g, "$1"));
  }
  return items;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderDocTable(entries) {
  const byTier = new Map();
  for (const e of entries) {
    if (!byTier.has(e.tier)) byTier.set(e.tier, []);
    byTier.get(e.tier).push(e.name);
  }
  const lines = [
    "| Tier | Tools | Default behavior |",
    "|------|-------|-------------------|",
  ];
  for (const tier of [0, 1, 2]) {
    const tools = (byTier.get(tier) ?? []).sort();
    const meta = tierLabels[tier];
    const toolList = tools.length > 0
      ? tools.map((t) => `\`${t}\``).join(", ")
      : "(none)";
    lines.push(`| ${meta.label} | ${toolList} | ${meta.behavior} |`);
  }
  return lines.join("\n");
}

export function renderTomlPermissions(entries) {
  const lines = ["[permissions]"];
  for (const e of entries) {
    lines.push(`${e.name} = ${e.tier}`);
  }
  return lines.join("\n");
}

/**
 * Render the body of a string-array literal (the lines between `[` and `]`),
 * 2-space indented, double-quoted, trailing comma. Entries containing `.env`
 * carry an inline allow marker so the warning-severity `no-env-file-leakage`
 * nexus-check rule stays quiet on the generated artifacts (matching the prior
 * hand-written secretPaths.ts hygiene).
 */
export function renderArrayBody(items) {
  return items
    .map((it) => {
      const comment = it.includes(".env")
        ? " // gemma-check-allow: no-env-file-leakage"
        : "";
      return `  ${JSON.stringify(it)},${comment}`;
    })
    .join("\n");
}

export function renderGeneratedTs(egress, secretPaths) {
  return `// GENERATED FILE. Do not edit by hand.
// Run \`npm run security:gen\` to regenerate from nexus.security.toml.
//
// v1.4.0 Phase 4 (A1) -- the safety-config SSOT (nexus.security.toml) is the
// authored source for the egress denylist (A4) and the secret-path denylist;
// scripts/generate-tool-permission-table.mjs writes this module so the runtime
// guards (ssrf.ts, secretPaths.ts) read exactly what the SSOT declares. The CI
// drift gate (\`npm run security:check\`) fails if this file diverges from the
// SSOT.

/** Egress denylist (A4): named exfil destinations blocked by the SSRF guard. */
export const DEFAULT_EGRESS_DENYLIST: readonly string[] = [
${renderArrayBody(egress)}
];

/** Secret-path denylist: globs for files that may hold secrets. */
export const SECRET_PATH_PATTERNS: readonly string[] = [
${renderArrayBody(secretPaths)}
];
`;
}

/** The `export const SECRET_PATH_PATTERNS = ...` statement inserted between the
 * .mjs markers (the markers themselves are preserved by replaceBetweenMarkers). */
function renderMjsSecretPathsInner(secretPaths) {
  return `export const SECRET_PATH_PATTERNS = Object.freeze([
${renderArrayBody(secretPaths)}
]);`;
}

// ---------------------------------------------------------------------------
// Marker replacement
// ---------------------------------------------------------------------------

/**
 * Replace the doc permission table between its markers, preserving the exact
 * historical layout (note line, blank lines) so the committed doc does not
 * churn.
 */
function buildDoc(docText, table) {
  const beginIdx = docText.indexOf(docBeginMarker);
  const endIdx = docText.indexOf(docEndMarker);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) {
    throw new Error(
      `Markers not found in ${docPath}. Expected ${docBeginMarker} and ${docEndMarker}.`,
    );
  }
  const before = docText.slice(0, beginIdx + docBeginMarker.length);
  const after = docText.slice(endIdx);
  const generatedNote =
    "<!-- Generated by scripts/generate-tool-permission-table.mjs from src/guardrails/PermissionTiers.ts. Do not edit manually. -->";
  return `${before}\n${generatedNote}\n\n${table}\n\n${after}`;
}

/**
 * Replace the content between a begin-marker line and an end marker, preserving
 * the full begin-marker line (including any trailing parenthetical) and the end
 * marker. `innerContent` is inserted on its own line(s) between them.
 */
function replaceBetweenMarkers(text, beginMarker, endMarker, innerContent, label) {
  const beginIdx = text.indexOf(beginMarker);
  const endIdx = text.indexOf(endMarker);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) {
    throw new Error(
      `Markers not found in ${label}. Expected ${beginMarker} and ${endMarker}.`,
    );
  }
  const beginLineEnd = text.indexOf("\n", beginIdx);
  const beforeEnd = beginLineEnd < 0 ? beginIdx + beginMarker.length : beginLineEnd;
  const before = text.slice(0, beforeEnd);
  const after = text.slice(endIdx);
  return `${before}\n${innerContent}\n${after}`;
}

// ---------------------------------------------------------------------------
// Apply / check
// ---------------------------------------------------------------------------

function readLf(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

/**
 * Compare `nextContent` against the file on disk. In check mode, record drift;
 * otherwise write when changed. Returns `true` when in sync (or written).
 */
function applyOrCheck(filePath, nextContent, check, drift) {
  const current = readLf(filePath);
  if (current === nextContent) {
    return true;
  }
  const rel = path.relative(repoRoot, filePath);
  if (check) {
    drift.push(rel);
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, nextContent, "utf8");
  process.stdout.write(`[security:gen] Updated ${rel}\n`);
  return true;
}

function run(check) {
  const ssot = readLf(ssotPath);
  if (ssot === null) {
    throw new Error(`SSOT not found at ${ssotPath}`);
  }
  const permSource = fs.readFileSync(permTiersPath, "utf8");

  const entries = parseToolMap(permSource);
  const egress = readTomlStringArray(ssot, "egress_denylist");
  const secretPaths = readTomlStringArray(ssot, "path_denylist");

  const docCurrent = readLf(docPath);
  if (docCurrent === null) {
    throw new Error(`Doc not found at ${docPath}`);
  }

  const artifacts = [
    { path: docPath, next: buildDoc(docCurrent, renderDocTable(entries)) },
    {
      path: ssotPath,
      next: replaceBetweenMarkers(
        ssot,
        tomlPermBeginMarker,
        tomlPermEndMarker,
        renderTomlPermissions(entries),
        "nexus.security.toml",
      ),
    },
    { path: generatedTsPath, next: renderGeneratedTs(egress, secretPaths) },
    {
      path: secretPathsMjsPath,
      next: replaceBetweenMarkers(
        readLf(secretPathsMjsPath) ?? "",
        mjsBeginMarker,
        mjsEndMarker,
        renderMjsSecretPathsInner(secretPaths),
        "scripts/hooks/lib/secret-paths.mjs",
      ),
    },
  ];

  const drift = [];
  for (const a of artifacts) {
    applyOrCheck(a.path, a.next, check, drift);
  }

  if (check) {
    if (drift.length > 0) {
      process.stderr.write(
        `[security:check] Safety surfaces are out of sync with the SSOT:\n` +
          drift.map((f) => `  - ${f}`).join("\n") +
          `\nRun \`npm run security:gen\` and commit the result.\n`,
      );
      process.exit(1);
    }
    process.stdout.write("[security:check] All safety surfaces in sync.\n");
    return;
  }

  process.stdout.write("[security:gen] Done.\n");
}

// Run only when invoked directly (e.g. `node scripts/generate-tool-permission-table.mjs`),
// not when imported by a test that exercises the exported pure functions.
const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  run(process.argv.includes("--check"));
}
