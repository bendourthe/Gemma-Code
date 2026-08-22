/**
 * v2.2.0 Phase 8 -- the sidecar bundle must be buildable and runnable.
 *
 * Two real defects motivated these, both of which shipped:
 *
 *   1. The bundle could not resolve `vscode`, reached through the coding
 *      runtime's logger, so `npm run build:sidecar` failed outright.
 *   2. better-sqlite3 is a native addon. Bundling its JS wrapper inlined a
 *      require for a .node binary that was then looked up relative to the
 *      bundle and never found, so the sidecar died at startup before answering
 *      a single request.
 *
 * Since Phase 1 the installer embeds `sidecar/dist` as a Tauri resource, so
 * either failure is a shipped app with no backend.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const CONFIG = readFileSync(
  path.join(ROOT, "desktop/sidecar/esbuild.config.mjs"),
  "utf8",
);

describe("sidecar bundle configuration", () => {
  it("aliases vscode to a shim for both entry points", () => {
    // Two entry points exist because main.js has import-time side effects the
    // catalog CLI must not trigger. Both reach the coding runtime.
    const aliases = CONFIG.match(/alias: \{ vscode: vscodeShim \}/g) ?? [];
    expect(aliases.length).toBe(2);
  });

  it("keeps the native database addon external", () => {
    // Inlining it produces a bundle that dies on first construction.
    expect(CONFIG).toContain('"better-sqlite3"');
    expect(CONFIG).toMatch(/external: \[[^\]]*"better-sqlite3"/);
  });

  it("fails the build when the native binary is absent", () => {
    // A silent skip here would produce an installer whose sidecar cannot open
    // its database, which is indistinguishable to the user from "nothing
    // works".
    expect(CONFIG).toContain("better_sqlite3.node missing after copy");
    expect(CONFIG).toContain("throw new Error");
  });
});

describe("vscode shim", () => {
  const SHIM = readFileSync(
    path.join(ROOT, "desktop/sidecar/src/shims/vscode.ts"),
    "utf8",
  );

  it("writes to stderr, never stdout", () => {
    // stdout carries the line-delimited JSON-RPC stream. A log line there
    // corrupts the protocol rather than merely being noisy.
    expect(SHIM).toContain("process.stderr.write");
    expect(SHIM).not.toContain("process.stdout.write");
    expect(SHIM).not.toContain("console.log");
  });

  it("exposes only the surface the logger uses", () => {
    // A broader fake would let extension-only code compile here and fail at
    // runtime instead of at the build.
    expect(SHIM).toContain("createOutputChannel");
    expect(SHIM).not.toContain("workspace");
    expect(SHIM).not.toContain("commands");
  });
});

describe("installer packaging", () => {
  it("builds the hub catalog snapshot on every platform", () => {
    // The PyInstaller spec has embedded this snapshot since Phase 3, but no
    // build script produced it, so every installer shipped without an offline
    // harness.
    for (const script of [
      "scripts/installer/build/build-windows.ps1",
      "scripts/installer/build/build-linux.sh",
      "scripts/installer/build/build-macos.sh",
    ]) {
      const source = readFileSync(path.join(ROOT, script), "utf8");
      expect(source, `${script} must build the hub snapshot`).toContain(
        "build-hub-snapshot.py",
      );
    }
  });

  it("treats a missing local catalog as non-fatal", () => {
    // A build host without a catalog should still produce an installer; it
    // just syncs at install time instead of shipping the snapshot.
    const win = readFileSync(
      path.join(ROOT, "scripts/installer/build/build-windows.ps1"),
      "utf8",
    );
    expect(win).toContain("will sync at install time");
  });
});
