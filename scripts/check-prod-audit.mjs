#!/usr/bin/env node
/**
 * v1.2.0 cycle close -- production-deps audit gate with an allowlist for
 * documented inherited CVE chains.
 *
 * v1.4.0 Phase 8 (gap 7.x.P1.D, RESOLVED): the protobufjs CVE chain that
 * previously dominated this gate --
 *
 *   @xenova/transformers@2.17.2 -> onnxruntime-web@1.14 -> onnx-proto -> protobufjs@6.x
 *
 * (one critical + three high advisories) was eliminated by migrating the
 * local embedder off the abandoned `@xenova/transformers` (2.17.2 was its
 * final release) to its maintained successor `@huggingface/transformers@4.x`.
 * The new package's `onnxruntime-web@1.26` drops `onnx-proto` entirely and
 * pulls `protobufjs@^7.2.4` (patched), so `@xenova/transformers`,
 * `onnxruntime-web`, `onnx-proto`, and `protobufjs` no longer appear in the
 * production audit and have been removed from the allowlist below. See
 * `core/memory/LocalEmbedder.ts` for the call-site migration.
 *
 * v1.6.0 cycle close (ENV.P5.A): a DIFFERENT protobufjs advisory later
 * surfaced -- GHSA-f38q-mgvj-vph7 (prototype-shadowing, moderate) on
 * protobufjs@7.6.2, still reached only as the OPTIONAL
 * @huggingface/transformers -> onnxruntime-web -> protobufjs transitive. The
 * 7.x line ends at the vulnerable 7.6.2 and onnxruntime-web pins
 * `protobufjs@^7.2.4`, so the only patch (protobufjs@8.x) is a semver-major
 * move outside that range; it is re-allowlisted below with a reachability
 * note. The co-occurring dompurify advisories WERE fixed in-range via an
 * `overrides` bump to dompurify@^3.4.11 (package.json).
 *
 * What remains allowlisted: `brace-expansion` -- a moderate-severity DoS
 * (GHSA-jxxr-4gwj-5jf2) carried as a deep transitive in the production tree
 * (via minimatch and friends); `npm dedupe` only fixes it locally and reverts
 * on the next `npm ci`, and no non-major upstream bump is available; and
 * `protobufjs` (see above).
 *
 * Behaviour:
 *   1. Run `npm audit --omit=dev --json`.
 *   2. Filter out the documented allowlisted package(s) by name.
 *   3. If any non-allowlisted advisory has severity >= moderate -> fail.
 *   4. If only allowlisted advisories remain -> pass with a summary.
 *
 * Exit codes:
 *   0  pass (clean OR only allowlisted)
 *   1  fail (non-allowlisted advisory at severity >= moderate)
 *   2  internal error (audit command crashed, JSON parse failed, etc.)
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const ALLOWLIST = new Set([
  // brace-expansion moderate-severity DoS (GHSA-jxxr-4gwj-5jf2) carried as a
  // deep transitive in the production tree; npm dedupe would only fix it
  // locally and revert on the next `npm ci`, and no non-major upstream bump
  // is available. The @xenova/transformers -> onnx-proto -> protobufjs chain
  // that used to be allowlisted here was resolved in v1.4.0 Phase 8 by the
  // migration to @huggingface/transformers@4.x (see header).
  "brace-expansion",
  // protobufjs moderate-severity prototype-shadowing advisory
  // (GHSA-f38q-mgvj-vph7) on protobufjs@7.6.2, reached only as an OPTIONAL
  // transitive: @huggingface/transformers (optionalDependencies) ->
  // onnxruntime-web -> protobufjs. The advisory requires parsing an
  // attacker-controlled .proto schema; the ONNX runtime only ever loads the
  // fixed, bundled ONNX model schema, so it is not reachable with untrusted
  // input. No in-range fix exists: the protobufjs 7.x line ends at the
  // vulnerable 7.6.2, and onnxruntime-web pins `protobufjs@^7.2.4`, so the
  // only patch (protobufjs@8.x) is a semver-major move outside that range.
  // The co-occurring dompurify advisories WERE fixed in-range via an
  // `overrides` bump to dompurify@^3.4.11 (package.json). Tracked as ENV.P5.A.
  "protobufjs",
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
      "[check-prod-audit] Allowlisted (documented inherited transitives):\n",
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
