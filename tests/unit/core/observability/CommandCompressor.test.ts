/**
 * v1.2.0 Phase 2 -- CommandCompressor unit tests.
 *
 * Exercises each of the four strategies plus the tee + retention surface.
 * Each strategy block carries one positive case (the strategy fires and
 * reduces output meaningfully) and one negative case (a command that
 * should not match the strategy returns unchanged or only minimally
 * compressed output).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CommandCompressor,
  DEFAULT_REGISTRY,
  DEFAULT_TRUNCATE_BYTES,
  classify,
  dedupeStrategy,
  filterStrategy,
  groupStrategy,
  truncateStrategy,
} from "../../../../core/observability/CommandCompressor.js";

function makeTempHome(): { homeFn: () => string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command-compressor-"));
  return {
    homeFn: () => dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

describe("classify", () => {
  it("routes git/grep/ls/eslint to filter", () => {
    expect(classify("git status")).toEqual({ primary: "filter" });
    expect(classify("grep -r foo .")).toEqual({ primary: "filter" });
    expect(classify("ls -la")).toEqual({ primary: "filter" });
    expect(classify("eslint src/")).toEqual({ primary: "filter" });
  });

  it("routes package-manager install to group", () => {
    expect(classify("npm install")).toEqual({ primary: "group" });
    expect(classify("cargo build")).toEqual({ primary: "group" });
  });

  it("routes test runners to dedupe (incl. via npm/pnpm/yarn run)", () => {
    expect(classify("pytest -q")).toEqual({ primary: "dedupe" });
    expect(classify("vitest run")).toEqual({ primary: "dedupe" });
    expect(classify("npm test")).toEqual({ primary: "dedupe" });
    expect(classify("pnpm run test")).toEqual({ primary: "dedupe" });
    expect(classify("cargo test")).toEqual({ primary: "dedupe" });
    expect(classify("npx vitest")).toEqual({ primary: "dedupe" });
  });

  it("returns null for commands outside the registry", () => {
    expect(classify("echo hi")).toBeNull();
    expect(classify("mycustomtool")).toBeNull();
    expect(classify("")).toBeNull();
  });
});

describe("filterStrategy", () => {
  it("drops git progress + hint + branch lines (positive)", () => {
    const raw = [
      "On branch main",
      "Your branch is up to date with 'origin/main'.",
      "",
      "Changes not staged for commit:",
      "  (use \"git add <file>...\" to update what will be committed)",
      "  (use \"git restore <file>...\" to discard changes)",
      "\tmodified:   src/foo.ts",
      "\tmodified:   src/bar.ts",
      "",
      "no changes added to commit",
    ].join("\n");
    const out = filterStrategy(raw, "git status");
    expect(out).toContain("modified:   src/foo.ts");
    expect(out).toContain("modified:   src/bar.ts");
    expect(out).not.toContain("On branch");
    expect(out).not.toContain("(use ");
    expect(out).not.toContain("Your branch");
  });

  it("drops binary-without-path noise from grep (positive)", () => {
    const raw = [
      "src/foo.ts:42:    return needle;",
      "Binary file matches",
      "src/bar.ts:99:    if (needle === undefined) return;",
    ].join("\n");
    const out = filterStrategy(raw, "grep -r needle .");
    expect(out).toContain("src/foo.ts:42");
    expect(out).toContain("src/bar.ts:99");
    expect(out).not.toContain("Binary file matches");
  });

  it("drops `total N` lines from ls (positive)", () => {
    const raw = ["total 48", "drwxr-xr-x 5 user user 4096 May 26 10:00 .", "-rw-r--r-- 1 user user  128 May 26 10:00 README.md"].join("\n");
    const out = filterStrategy(raw, "ls -la");
    expect(out).not.toMatch(/^total/m);
    expect(out).toContain("README.md");
  });

  it("does not strip path-bearing 'Binary file ... matches' (negative)", () => {
    const raw = "Binary file src/asset.bin matches";
    const out = filterStrategy(raw, "grep -r foo .");
    expect(out).toContain("Binary file src/asset.bin matches");
  });
});

describe("groupStrategy", () => {
  it("collapses cargo `Compiling <crate>` runs (positive)", () => {
    const raw = [
      "   Compiling serde v1.0.0",
      "   Compiling serde v1.0.0",
      "   Compiling tokio v1.30.0",
      "   Compiling tokio v1.30.0",
      "   Compiling tokio v1.30.0",
      "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 12.34s",
    ].join("\n");
    const out = groupStrategy(raw, "cargo build");
    expect(out).toContain("Compiling serde (x2)");
    expect(out).toContain("Compiling tokio (x3)");
    expect(out).toContain("Finished");
  });

  it("collapses npm install to its summary lines (positive)", () => {
    const raw = [
      ...Array.from({ length: 200 }, (_, i) => `npm http GET https://registry.npmjs.org/pkg-${i}`),
      "added 200 packages in 12s",
      "audited 250 packages",
      "found 0 vulnerabilities",
    ].join("\n");
    const out = groupStrategy(raw, "npm install");
    expect(out).toContain("added 200 packages");
    expect(out).toContain("found 0 vulnerabilities");
    expect(out.length).toBeLessThan(raw.length * 0.5);
  });

  it("collapses identical adjacent lines via the generic fallback (negative)", () => {
    const raw = "foo\nfoo\nfoo\nbar\nbar\nbaz";
    const out = groupStrategy(raw, "unknowncmd");
    expect(out).toContain("foo (x3)");
    expect(out).toContain("bar (x2)");
    expect(out).toContain("baz");
  });
});

describe("truncateStrategy", () => {
  it("elides the middle of long output and inserts a pending marker (positive)", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
    const raw = lines.join("\n");
    const out = truncateStrategy(raw, "anything");
    expect(out).toContain("line 0");
    expect(out).toContain("line 199");
    expect(out).toContain("line 999");
    expect(out).toContain("[...");
    expect(out).toContain("lines elided");
    expect(out).toContain("<pending>");
    expect(out.length).toBeLessThan(raw.length);
  });

  it("returns the input unchanged when below the line cap (negative)", () => {
    const raw = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const out = truncateStrategy(raw, "anything");
    expect(out).toBe(raw);
    expect(out).not.toContain("elided");
  });
});

describe("dedupeStrategy", () => {
  it("collapses adjacent identical PASS lines (positive)", () => {
    const raw = [
      "PASSED tests/a.test.ts",
      "PASSED tests/a.test.ts",
      "PASSED tests/a.test.ts",
      "PASSED tests/b.test.ts",
      "FAILED tests/c.test.ts",
    ].join("\n");
    const out = dedupeStrategy(raw, "pytest");
    expect(out).toContain("PASSED tests/a.test.ts (x3)");
    expect(out).toContain("PASSED tests/b.test.ts");
    expect(out).toContain("FAILED tests/c.test.ts");
  });

  it("returns unique lines unchanged (negative)", () => {
    const raw = "alpha\nbeta\ngamma";
    expect(dedupeStrategy(raw, "pytest")).toBe(raw);
  });
});

describe("CommandCompressor.compress", () => {
  it("returns passthrough for unknown commands", () => {
    const cc = new CommandCompressor({ nexusHomeFn: makeTempHome().homeFn });
    const raw = "hello\nworld";
    const out = cc.compress("echo hi", raw, 0);
    expect(out.strategyApplied).toBe("passthrough");
    expect(out.rendered).toBe(raw);
    expect(out.teePath).toBeNull();
    expect(out.originalBytes).toBe(Buffer.byteLength(raw, "utf8"));
    expect(out.compressedBytes).toBe(out.originalBytes);
  });

  it("applies the registered strategy on a known command", () => {
    const cc = new CommandCompressor({ nexusHomeFn: makeTempHome().homeFn });
    const raw = [
      "PASSED tests/a.test.ts",
      "PASSED tests/a.test.ts",
      "PASSED tests/b.test.ts",
    ].join("\n");
    const out = cc.compress("pytest -q", raw, 0);
    expect(out.strategyApplied).toBe("dedupe");
    expect(out.rendered).toContain("(x2)");
    expect(out.compressedBytes).toBeLessThan(out.originalBytes);
  });

  it("falls back to truncate when post-primary still exceeds the cap", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({
      nexusHomeFn: home.homeFn,
      truncateBytes: 1024,
    });
    // 5000 unique grep lines, none filtered out, will exceed 1 KB.
    const lines = Array.from({ length: 5000 }, (_, i) => `src/file${i}.ts:1:hit ${i}`);
    const raw = lines.join("\n");
    const out = cc.compress("grep -r hit .", raw, 0);
    expect(out.strategyApplied).toBe("truncate");
    expect(out.compressedBytes).toBeLessThan(out.originalBytes);
    expect(out.rendered).toContain("lines elided");
    home.cleanup();
  });

  it("does not tee on success when truncate elision is below the delta", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({
      nexusHomeFn: home.homeFn,
      truncateBytes: 1024,
      successTeeLineDelta: 10_000,
    });
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}-${"x".repeat(20)}`);
    const out = cc.compress("grep -r foo .", lines.join("\n"), 0);
    expect(out.teePath).toBeNull();
    home.cleanup();
  });

  it("tees on success when truncate elision exceeds the delta", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({
      nexusHomeFn: home.homeFn,
      truncateBytes: 1024,
      successTeeLineDelta: 100,
    });
    const lines = Array.from({ length: 5000 }, (_, i) => `src/file${i}.ts:1:hit ${i}`);
    const raw = lines.join("\n");
    const out = cc.compress("grep -r hit .", raw, 0);
    expect(out.teePath).toBeTruthy();
    expect(fs.existsSync(out.teePath!)).toBe(true);
    expect(fs.readFileSync(out.teePath!, "utf8")).toBe(raw);
    expect(out.rendered).toContain(out.teePath!);
    home.cleanup();
  });

  it("tees on failure regardless of truncation", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({ nexusHomeFn: home.homeFn });
    const raw = "PASSED tests/a.test.ts\nPASSED tests/b.test.ts\nFAILED tests/c.test.ts";
    const out = cc.compress("pytest -q", raw, 1);
    expect(out.teePath).toBeTruthy();
    expect(fs.existsSync(out.teePath!)).toBe(true);
    expect(fs.readFileSync(out.teePath!, "utf8")).toBe(raw);
    home.cleanup();
  });
});

describe("CommandCompressor.tee", () => {
  it("writes under <nexus-home>/logs/commands and returns the path", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({ nexusHomeFn: home.homeFn });
    const teePath = cc.tee("git status", "raw output");
    expect(teePath.startsWith(home.homeFn())).toBe(true);
    expect(teePath).toContain(path.join("logs", "commands"));
    expect(fs.readFileSync(teePath, "utf8")).toBe("raw output");
    home.cleanup();
  });

  it("scrubs secrets before writing a tee file", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({ nexusHomeFn: home.homeFn });
    const secret = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    const teePath = cc.tee("curl example", `Authorization: ${secret}`);
    const body = fs.readFileSync(teePath, "utf8");
    expect(body).not.toContain(secret);
    expect(body).toContain("<redacted>");
    home.cleanup();
  });

  it("filename is ISO-stamp-safe on Windows (no `:` characters)", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({
      nexusHomeFn: home.homeFn,
      nowFn: () => new Date("2026-05-26T12:34:56.789Z"),
    });
    const teePath = cc.tee("git diff", "diff body");
    expect(path.basename(teePath)).not.toContain(":");
    expect(path.basename(teePath)).toContain("git");
    home.cleanup();
  });
});

describe("CommandCompressor.pruneOldTees", () => {
  it("removes files older than the retention horizon and keeps fresh ones", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({
      nexusHomeFn: home.homeFn,
      teeRetentionDays: 14,
    });
    const dir = cc.commandsLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, "stale.log");
    const fresh = path.join(dir, "fresh.log");
    fs.writeFileSync(stale, "old", "utf8");
    fs.writeFileSync(fresh, "new", "utf8");
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    fs.utimesSync(stale, longAgo, longAgo);

    const removed = cc.pruneOldTees();
    expect(removed).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    home.cleanup();
  });

  it("returns 0 when the logs directory does not yet exist", () => {
    const home = makeTempHome();
    const cc = new CommandCompressor({ nexusHomeFn: home.homeFn });
    expect(cc.pruneOldTees()).toBe(0);
    home.cleanup();
  });
});

describe("DEFAULT_REGISTRY + DEFAULT_TRUNCATE_BYTES sanity", () => {
  it("covers the 8 commands the plan lists", () => {
    for (const cmd of ["git", "npm", "cargo", "pytest", "eslint", "grep", "ls", "cat"]) {
      expect(DEFAULT_REGISTRY[cmd]).toBeDefined();
    }
  });

  it("truncate threshold is 10 KB", () => {
    expect(DEFAULT_TRUNCATE_BYTES).toBe(10 * 1024);
  });
});
