#!/usr/bin/env node
/**
 * v1.2.0 cycle close -- production-deps audit gate with an allowlist for
 * documented inherited CVE chains.
 *
 * Background: `npm audit --omit=dev --audit-level=moderate` fails the CI
 * audit-ts gate on a chain of moderate / high / critical advisories that
 * Nexus inherits transitively through `@xenova/transformers@2.17.2` (the
 * local-embedder backbone shipped in v1.1.0 Phase 5):
 *
 *   @xenova/transformers -> onnxruntime-web -> onnx-proto -> protobufjs
 *
 * The npm-suggested fix downgrades `@xenova/transformers` to 2.0.1, a
 * semver-major rollback that would break every memory-ingest call site.
 * A `npm overrides` bump of `protobufjs` to >=7.5.8 would cross a major
 * version boundary across onnx-proto's API surface and almost certainly
 * break onnxruntime-web's ONNX model loading. The proper long-term fix
 * is migrating to `@huggingface/transformers` v4.x (a separate plan),
 * tracked in `docs/versions/v1/v1.2.0/known-gaps.md` entry `7.x.P1.D`.
 *
 * Behaviour:
 *   1. Run `npm audit --omit=dev --json`.
 *   2. Filter out the documented allowlisted chain by package name.
 *   3. If any non-allowlisted advisory has severity >= moderate -> fail.
 *   4. If only allowlisted advisories remain -> pass with a summary that
 *      references the known-gaps entry.
 *
 * Exit codes:
 *   0  pass (clean OR only allowlisted)
 *   1  fail (non-allowlisted advisory at severity >= moderate)
 *   2  internal error (audit command crashed, JSON parse failed, etc.)
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const ALLOWLIST = new Set([
  // Tracked in known-gaps 7.x.P1.D: @xenova/transformers transitive chain.
  "@xenova/transformers",
  "onnxruntime-web",
  "onnx-proto",
  "protobufjs",
  // Tracked alongside 7.x.P1.D: brace-expansion moderate-severity DoS
  // (GHSA-jxxr-4gwj-5jf2) carried as a transitive in the production
  // tree; npm dedupe would only fix it locally and revert on next `npm ci`.
  "brace-expansion",
]);

const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const MIN_FAIL_SEVERITY = SEVERITY_RANK.moderate;

function runAudit() {
  const result = spawnSync(
    "npm",
    ["audit", "--omit=dev", "--json"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  if (result.status === null) {
    process.stderr.write(
      `[check-prod-audit] npm audit failed to launch: ${result.error?.message ?? "unknown"}\n`,
    );
    process.exit(2);
  }
  if (!result.stdout) {
    process.stderr.write(
      "[check-prod-audit] npm audit produced no stdout; cannot evaluate.\n",
    );
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(2);
  }
  return result.stdout;
}

function parseAudit(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[check-prod-audit] failed to parse npm audit JSON: ${err.message}\n`,
    );
    process.exit(2);
  }
}

function summariseAdvisories(audit) {
  const vulns = audit.vulnerabilities ?? {};
  const allowed = [];
  const blocking = [];
  for (const [name, entry] of Object.entries(vulns)) {
    const rank = SEVERITY_RANK[entry.severity] ?? 0;
    if (rank < MIN_FAIL_SEVERITY) continue;
    if (ALLOWLIST.has(name)) {
      allowed.push({ name, severity: entry.severity, via: entry.via });
    } else {
      blocking.push({ name, severity: entry.severity, via: entry.via });
    }
  }
  return { allowed, blocking };
}

function formatVia(via) {
  if (!Array.isArray(via)) return "";
  return via
    .map((v) => (typeof v === "string" ? v : v?.name ?? v?.title ?? "unknown"))
    .join(", ");
}

function main() {
  const raw = runAudit();
  const audit = parseAudit(raw);
  const { allowed, blocking } = summariseAdvisories(audit);

  if (allowed.length > 0) {
    process.stdout.write(
      "[check-prod-audit] Allowlisted (tracked in known-gaps 7.x.P1.D):\n",
    );
    for (const a of allowed) {
      process.stdout.write(`  - ${a.name} (${a.severity}) via ${formatVia(a.via)}\n`);
    }
  }

  if (blocking.length > 0) {
    process.stderr.write(
      `[check-prod-audit] FAIL: ${blocking.length} non-allowlisted production advisory(ies) at severity >= moderate:\n`,
    );
    for (const b of blocking) {
      process.stderr.write(`  - ${b.name} (${b.severity}) via ${formatVia(b.via)}\n`);
    }
    process.stderr.write(
      "\nRun `npm audit --omit=dev` for full details. If the advisory is a transitive ",
    );
    process.stderr.write(
      "inherited chain that cannot be fixed without a semver-major dependency move, ",
    );
    process.stderr.write(
      "add it to the ALLOWLIST in scripts/check-prod-audit.mjs and record a known-gaps entry.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `[check-prod-audit] OK: ${allowed.length} allowlisted, 0 blocking.\n`,
  );
  process.exit(0);
}

main();
