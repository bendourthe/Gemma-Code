/**
 * Unit + end-to-end tests for the safety-config SSOT generator
 * (`scripts/generate-tool-permission-table.mjs`, v1.4.0 Phase 4 / A1).
 *
 * Coverage:
 *   - `readTomlStringArray` round-trips the AUTHORED `[network]` / `[secrets]`
 *     sections of nexus.security.toml, and those values match the runtime
 *     guards (proving the SSOT is the real source).
 *   - the render functions are deterministic and reproduce the committed
 *     generated artifacts byte-for-byte (idempotency).
 *   - the end-to-end drift gate: `--check` passes on the committed tree, fails
 *     when a generated surface is hand-edited, and `npm run security:gen`
 *     (regeneration) fixes it.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// @ts-expect-error -- .mjs script export, no .d.ts by design.
import {
  readTomlStringArray,
  parseToolMap,
  renderGeneratedTs,
  renderTomlPermissions,
  renderArrayBody,
} from "../../../scripts/generate-tool-permission-table.mjs";

import {
  DEFAULT_EGRESS_DENYLIST,
  SECRET_PATH_PATTERNS as GENERATED_SECRET_PATHS,
} from "../../../modules/coding/utils/generated/safetyConfig.generated.js";
import { DEFAULT_DENIED_DESTINATIONS } from "../../../modules/coding/utils/ssrf.js";
import { SECRET_PATH_PATTERNS as RUNTIME_SECRET_PATHS } from "../../../modules/coding/utils/secretPaths.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/generate-tool-permission-table.mjs");
const SSOT = path.join(REPO_ROOT, "nexus.security.toml");
const GENERATED_TS = path.join(
  REPO_ROOT,
  "modules/coding/utils/generated/safetyConfig.generated.ts",
);
const PERM_TIERS = path.join(REPO_ROOT, "modules/coding/guardrails/PermissionTiers.ts");

function readLf(p: string): string {
  return fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
}

function runGenerator(args: string[]): number {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return res.status ?? -1;
}

// ---------------------------------------------------------------------------
// readTomlStringArray (round-trip / parser)
// ---------------------------------------------------------------------------

describe("readTomlStringArray", () => {
  const ssot = readLf(SSOT);

  it("parses the authored egress denylist and it matches the runtime guard", () => {
    const egress = readTomlStringArray(ssot, "egress_denylist");
    // The SSOT is the source: the generated artifact and the live SSRF guard
    // both equal what the TOML declares.
    expect(egress).toEqual([...DEFAULT_EGRESS_DENYLIST]);
    expect([...DEFAULT_DENIED_DESTINATIONS]).toEqual(egress);
    // Spot-check the security-relevant anchors survive the round trip.
    expect(egress).toContain("169.254.169.254");
    expect(egress).toContain("pastebin.com");
  });

  it("parses the authored secret-path denylist and it matches both copies", () => {
    const paths = readTomlStringArray(ssot, "path_denylist");
    expect(paths).toEqual([...GENERATED_SECRET_PATHS]);
    expect([...RUNTIME_SECRET_PATHS]).toEqual(paths);
    expect(paths).toContain("**/.env*");
    expect(paths).toContain("**/.nexus/mcp.json");
  });

  it("ignores `#` comments interleaved between array entries", () => {
    const toml = `[network]\negress_denylist = [\n  # a comment\n  "a.test",\n  "b.test", # trailing\n]\n`;
    expect(readTomlStringArray(toml, "egress_denylist")).toEqual(["a.test", "b.test"]);
  });

  it("throws when the key is absent", () => {
    expect(() => readTomlStringArray("[secrets]\npath_denylist = []\n", "missing_key")).toThrow(
      /not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// parseToolMap + renderers (determinism / idempotency)
// ---------------------------------------------------------------------------

describe("permission-tier parsing and rendering", () => {
  const permSource = fs.readFileSync(PERM_TIERS, "utf8");

  it("parses TOOL_PERMISSION_MAP with the correct tier numbers", () => {
    const entries = parseToolMap(permSource);
    const byName = Object.fromEntries(entries.map((e: { name: string; tier: number }) => [e.name, e.tier]));
    expect(byName["read_file"]).toBe(0);
    expect(byName["write_file"]).toBe(1);
    expect(byName["run_terminal"]).toBe(2);
    expect(byName["fetch_page"]).toBe(2);
  });

  it("renders the [permissions] block that the committed SSOT mirrors", () => {
    const block = renderTomlPermissions(parseToolMap(permSource));
    expect(block.startsWith("[permissions]\n")).toBe(true);
    expect(readLf(SSOT)).toContain(block);
  });
});

describe("renderGeneratedTs (idempotency)", () => {
  const ssot = readLf(SSOT);
  const egress = readTomlStringArray(ssot, "egress_denylist");
  const secretPaths = readTomlStringArray(ssot, "path_denylist");

  it("reproduces the committed generated artifact byte-for-byte", () => {
    expect(renderGeneratedTs(egress, secretPaths)).toBe(readLf(GENERATED_TS));
  });

  it("is deterministic across repeated calls", () => {
    expect(renderGeneratedTs(egress, secretPaths)).toBe(renderGeneratedTs(egress, secretPaths));
  });
});

describe("renderArrayBody", () => {
  it("appends the no-env-file-leakage allow marker only to .env entries", () => {
    const body = renderArrayBody(["**/.env*", "**/id_rsa*"]);
    const lines = body.split("\n");
    expect(lines[0]).toBe('  "**/.env*", // gemma-check-allow: no-env-file-leakage');
    expect(lines[1]).toBe('  "**/id_rsa*",');
  });
});

// ---------------------------------------------------------------------------
// End-to-end drift gate
// ---------------------------------------------------------------------------

describe("safety-surface drift gate (--check)", () => {
  it("passes on the committed tree (artifacts in sync)", () => {
    expect(runGenerator(["--check"])).toBe(0);
  });

  it("fails when a generated surface is hand-edited, and regenerating fixes it", () => {
    const original = fs.readFileSync(SSOT, "utf8");
    try {
      // Inject a stray line into the generated [permissions] mirror region. No
      // test imports nexus.security.toml at runtime, so mutating it cannot race
      // with parallel workers; the literal end marker is line-ending agnostic.
      const mutated = original.replace(
        "# END:GENERATED-PERMISSIONS",
        "stray_hand_edit = 9\n# END:GENERATED-PERMISSIONS",
      );
      expect(mutated).not.toBe(original);
      fs.writeFileSync(SSOT, mutated, "utf8");

      // The drift gate must reject the hand edit ...
      expect(runGenerator(["--check"])).toBe(1);
      // ... and regenerating must restore a clean, passing state.
      expect(runGenerator([])).toBe(0);
      expect(runGenerator(["--check"])).toBe(0);
    } finally {
      // Belt-and-suspenders: restore the exact original bytes regardless of
      // outcome so the working tree is never left dirty.
      fs.writeFileSync(SSOT, original, "utf8");
    }
  });
});
