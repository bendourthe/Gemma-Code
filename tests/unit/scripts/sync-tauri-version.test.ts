/**
 * Unit + end-to-end tests for the Tauri version sync script
 * (`scripts/sync-tauri-version.mjs`, v1.8.0 Phase 1 / T101).
 *
 * Coverage:
 *   - `readRootVersion` extracts the version and fails closed on absence.
 *   - `syncedTauriConf` rewrites only the top-level `version`, preserves the
 *     2-space indentation + trailing newline, and is idempotent.
 *   - end-to-end: `--check` agrees with the committed tree state (after the
 *     apply mode has run, `--check` must pass).
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// @ts-expect-error -- .mjs script export, no .d.ts by design.
import { readRootVersion, syncedTauriConf } from "../../../scripts/sync-tauri-version.mjs";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/sync-tauri-version.mjs");
const TAURI_CONF = path.join(REPO_ROOT, "desktop/src-tauri/tauri.conf.json");

describe("readRootVersion", () => {
  it("extracts the version field", () => {
    expect(readRootVersion('{"name":"x","version":"2.1.0"}')).toBe("2.1.0");
  });

  it("throws when the version field is missing or empty", () => {
    expect(() => readRootVersion('{"name":"x"}')).toThrow(/no version/);
    expect(() => readRootVersion('{"version":""}')).toThrow(/no version/);
  });
});

describe("syncedTauriConf", () => {
  const conf = `{\n  "productName": "Nexus",\n  "version": "1.5.0",\n  "bundle": {\n    "active": true\n  }\n}\n`;

  it("rewrites only the top-level version and preserves everything else", () => {
    const { text, changed, previous } = syncedTauriConf(conf, "2.1.0");
    expect(changed).toBe(true);
    expect(previous).toBe("1.5.0");
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.productName).toBe("Nexus");
    expect(parsed.bundle).toEqual({ active: true });
  });

  it("keeps 2-space indentation and a trailing newline", () => {
    const { text } = syncedTauriConf(conf, "2.1.0");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "version": "2.1.0"');
  });

  it("is idempotent: a second sync reports no change and returns identical text", () => {
    const first = syncedTauriConf(conf, "2.1.0");
    const second = syncedTauriConf(first.text, "2.1.0");
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });
});

describe("end-to-end (spawned script)", () => {
  it("apply mode leaves the tree in a state where --check passes", () => {
    const original = fs.readFileSync(TAURI_CONF, "utf8");
    try {
      const apply = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
      expect(apply.status).toBe(0);
      const check = spawnSync(process.execPath, [SCRIPT, "--check"], { encoding: "utf8" });
      expect(check.status).toBe(0);
    } finally {
      fs.writeFileSync(TAURI_CONF, original);
    }
  });

  it("--check fails closed when the conf version drifts", () => {
    const original = fs.readFileSync(TAURI_CONF, "utf8");
    try {
      const drifted = JSON.parse(original);
      drifted.version = "0.0.0-drift";
      fs.writeFileSync(TAURI_CONF, `${JSON.stringify(drifted, null, 2)}\n`);
      const check = spawnSync(process.execPath, [SCRIPT, "--check"], { encoding: "utf8" });
      expect(check.status).toBe(1);
      expect(check.stderr).toContain("out of sync");
    } finally {
      fs.writeFileSync(TAURI_CONF, original);
    }
  });
});
