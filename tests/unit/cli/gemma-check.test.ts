/**
 * Unit tests for the gemma-check CLI and its rule set.
 *
 * Three layers:
 *   1. Pure rule tests: each rule's `scan(file, contents)` is exercised in
 *      isolation for positive cases, allowlist suppression, and comment
 *      / test-file skipping.
 *   2. Helper tests: parseArgs / walk / selectRules.
 *   3. End-to-end spawn tests: drive `node bin/gemma-check.mjs` against a
 *      temp tree and assert exit codes and report shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Importing .mjs from TS requires the .mjs extension verbatim. Vitest with
// Vite resolution handles this fine and TypeScript's Node16 moduleResolution
// accepts the explicit extension.
// @ts-expect-error -- no .d.ts for the .mjs helper, by design (it is a script, not a published API).
import { isAllowed, isInComment, isTestFile, isSecuritySensitiveFile, offsetToPosition, lineBounds } from "../../../lib/checks/helpers.mjs";
// @ts-expect-error -- script export, see above.
import * as noConsoleLog from "../../../lib/checks/no-committed-console-log.mjs";
// @ts-expect-error -- script export, see above.
import * as noMathRandom from "../../../lib/checks/no-math-random-for-tokens.mjs";
// @ts-expect-error -- script export, see above.
import * as noEnvLeakage from "../../../lib/checks/no-env-file-leakage.mjs";
// @ts-expect-error -- script export, see above.
import * as noSecretPatterns from "../../../lib/checks/no-secret-patterns.mjs";
// @ts-expect-error -- script export, see above.
import { RULES, RULE_BY_ID } from "../../../lib/checks/index.mjs";
// @ts-expect-error -- script export, see above.
import { parseArgs, walk, selectRules, scanPath, SCANNED_EXTENSIONS } from "../../../bin/gemma-check.mjs";

const BIN_PATH = path.resolve(__dirname, "../../../bin/gemma-check.mjs");

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-check-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, contents: string): string {
  const full = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf-8");
  return full;
}

// ---------------------------------------------------------------------------
// helpers.mjs
// ---------------------------------------------------------------------------

describe("helpers", () => {
  describe("isTestFile", () => {
    it("matches conventional test directories and filenames", () => {
      expect(isTestFile("tests/unit/foo.test.ts")).toBe(true);
      expect(isTestFile("test/foo.spec.js")).toBe(true);
      expect(isTestFile("src/__tests__/bar.ts")).toBe(true);
      expect(isTestFile("src/foo.test.tsx")).toBe(true);
      expect(isTestFile("src\\foo.spec.mjs")).toBe(true);
    });
    it("does not match production source", () => {
      expect(isTestFile("src/handler.ts")).toBe(false);
      expect(isTestFile("lib/checks/index.mjs")).toBe(false);
    });
  });

  describe("isSecuritySensitiveFile", () => {
    it("matches files with sensitive keywords in the basename", () => {
      expect(isSecuritySensitiveFile("src/auth/router.ts")).toBe(true);
      expect(isSecuritySensitiveFile("src/tokenStore.ts")).toBe(true);
      expect(isSecuritySensitiveFile("src/jwtVerifier.ts")).toBe(true);
    });
    it("rejects unrelated filenames", () => {
      expect(isSecuritySensitiveFile("src/utils/strings.ts")).toBe(false);
    });
  });

  describe("offsetToPosition", () => {
    it("maps a byte offset to 1-indexed line and column", () => {
      const text = "ab\ncde\nfg";
      expect(offsetToPosition(text, 0)).toEqual({ line: 1, column: 1 });
      expect(offsetToPosition(text, 3)).toEqual({ line: 2, column: 1 });
      expect(offsetToPosition(text, 5)).toEqual({ line: 2, column: 3 });
      expect(offsetToPosition(text, 7)).toEqual({ line: 3, column: 1 });
    });
  });

  describe("lineBounds", () => {
    it("returns line start (inclusive) and end (exclusive of newline)", () => {
      const text = "abc\nde\nf";
      expect(lineBounds(text, 1)).toEqual({ start: 0, end: 3 });
      expect(lineBounds(text, 4)).toEqual({ start: 4, end: 6 });
    });
  });

  describe("isInComment", () => {
    it("flags JSDoc continuations and line comments", () => {
      const text = " * use console.log";
      expect(isInComment(text, 6)).toBe(true);
    });
    it("flags single-line `//` comments at line start", () => {
      const text = "// some console.log note";
      expect(isInComment(text, 8)).toBe(true);
    });
    it("flags trailing `//` comments after code", () => {
      const text = "foo(); // skipped console.log";
      expect(isInComment(text, 20)).toBe(true);
    });
    it("does not flag code outside comments", () => {
      const text = "console.log('x')";
      expect(isInComment(text, 0)).toBe(false);
    });
  });

  describe("isAllowed", () => {
    it("respects same-line `gemma-check-allow` marker", () => {
      const text = `console.log('x') // gemma-check-allow: no-committed-console-log`;
      expect(isAllowed(text, 0, "no-committed-console-log")).toBe(true);
    });

    it("respects same-line `gemma-check-allow` without rule list", () => {
      const text = `console.log('x') // gemma-check-allow`;
      expect(isAllowed(text, 0, "any-rule-id")).toBe(true);
    });

    it("does not suppress a different rule when one is named", () => {
      const text = `console.log('x') // gemma-check-allow: some-other-rule`;
      expect(isAllowed(text, 0, "no-committed-console-log")).toBe(false);
    });

    it("respects previous-line `gemma-check-allow-next-line` marker", () => {
      const text = `// gemma-check-allow-next-line: no-committed-console-log\nconsole.log('x')`;
      const offset = text.indexOf("console.log");
      expect(isAllowed(text, offset, "no-committed-console-log")).toBe(true);
    });

    it("does not falsely treat `gemma-check-allow` as `gemma-check-allow-next-line`", () => {
      const text = `// gemma-check-allow-next-line\nconsole.log('x')`;
      const offset = text.indexOf("console.log");
      expect(isAllowed(text, offset, "any-rule")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------

describe("no-committed-console-log", () => {
  it("flags console.log in production code", () => {
    const findings = noConsoleLog.scan("src/foo.ts", "console.log('hi');\n");
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("no-committed-console-log");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].line).toBe(1);
  });

  it("does not flag test files", () => {
    expect(noConsoleLog.scan("tests/foo.test.ts", "console.log('hi');")).toEqual([]);
  });

  it("does not flag console.log inside comments", () => {
    expect(noConsoleLog.scan("src/foo.ts", "// console.log('hi');")).toEqual([]);
    expect(noConsoleLog.scan("src/foo.ts", " * console.log('hi');")).toEqual([]);
  });

  it("respects allow markers", () => {
    const code = "console.log('hi'); // gemma-check-allow: no-committed-console-log\n";
    expect(noConsoleLog.scan("src/foo.ts", code)).toEqual([]);
  });

  it("does not match console.warn or console.error", () => {
    expect(noConsoleLog.scan("src/foo.ts", "console.warn('hi');")).toEqual([]);
    expect(noConsoleLog.scan("src/foo.ts", "console.error('hi');")).toEqual([]);
  });
});

describe("no-math-random-for-tokens", () => {
  it("flags Math.random in security-sensitive files", () => {
    const findings = noMathRandom.scan("src/auth/token.ts", "const t = Math.random();");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("ignores non-sensitive files", () => {
    expect(noMathRandom.scan("src/utils/list.ts", "const r = Math.random();")).toEqual([]);
  });

  it("respects allow markers", () => {
    const code = "// gemma-check-allow-next-line: no-math-random-for-tokens\nconst t = Math.random();\n";
    expect(noMathRandom.scan("src/auth/token.ts", code)).toEqual([]);
  });
});

describe("no-env-file-leakage", () => {
  it("flags a string-literal .env reference", () => {
    const findings = noEnvLeakage.scan("src/loader.ts", `readFile(".env");`);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(".env");
  });

  it("does not flag property accessors like process.env", () => {
    expect(noEnvLeakage.scan("src/loader.ts", "const v = process.env.X;")).toEqual([]);
    expect(noEnvLeakage.scan("src/loader.ts", "const v = vscode.env.openExternal;")).toEqual([]);
  });

  it("does not flag test files or docs", () => {
    expect(noEnvLeakage.scan("tests/loader.test.ts", `readFile(".env");`)).toEqual([]);
    expect(noEnvLeakage.scan("docs/loader.md", `readFile(".env");`)).toEqual([]);
  });

  it("does not flag references inside comments", () => {
    expect(noEnvLeakage.scan("src/loader.ts", "// load .env at boot")).toEqual([]);
  });

  it("skips the .env.example literal", () => {
    expect(noEnvLeakage.scan("src/loader.ts", `const sample = ".env.example";`)).toEqual([]);
  });

  it("flags the .env.production family", () => {
    const findings = noEnvLeakage.scan("src/loader.ts", `readFile(".env.production");`);
    expect(findings).toHaveLength(1);
  });
});

describe("no-secret-patterns", () => {
  it("flags an AWS access key", () => {
    const findings = noSecretPatterns.scan("src/foo.ts", `const k = "AKIA${"X".repeat(16)}";`);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("AWS access key");
  });

  it("flags a GitHub PAT", () => {
    const findings = noSecretPatterns.scan("src/foo.ts", `const t = "ghp_${"a".repeat(36)}";`);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("GitHub PAT");
  });

  it("flags a PEM private-key block header", () => {
    const findings = noSecretPatterns.scan("src/foo.ts", "-----BEGIN PRIVATE KEY-----");
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("PEM private key");
  });

  it("flags an SSH private-key block header", () => {
    const findings = noSecretPatterns.scan("src/foo.ts", "-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(findings).toHaveLength(1);
  });

  it("does not flag benign text", () => {
    expect(noSecretPatterns.scan("src/foo.ts", "Just some normal source code")).toEqual([]);
  });

  it("respects allow markers", () => {
    const code = "// gemma-check-allow-next-line: no-secret-patterns\n-----BEGIN PRIVATE KEY-----";
    expect(noSecretPatterns.scan("src/foo.ts", code)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

describe("rule registry", () => {
  it("exposes a non-empty rule list", () => {
    expect(RULES.length).toBeGreaterThan(0);
  });

  it("includes the four shipped rules", () => {
    const ids = RULES.map((r: { id: string }) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "no-committed-console-log",
        "no-math-random-for-tokens",
        "no-env-file-leakage",
        "no-secret-patterns",
      ]),
    );
  });

  it("indexes rules by id", () => {
    expect(RULE_BY_ID["no-secret-patterns"]).toBeDefined();
    expect(RULE_BY_ID["nope-not-a-rule"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("defaults path to '.' when no positional is given", () => {
    const a = parseArgs([]);
    expect(a.paths).toEqual(["."]);
    expect(a.json).toBe(false);
  });

  it("parses --json", () => {
    expect(parseArgs(["--json"]).json).toBe(true);
  });

  it("parses --rule with a value", () => {
    expect(parseArgs(["--rule", "no-secret-patterns"]).rules).toEqual([
      "no-secret-patterns",
    ]);
  });

  it("collects positional paths", () => {
    const a = parseArgs(["src/", "lib/"]);
    expect(a.paths).toEqual(["src/", "lib/"]);
  });

  it("flags --help and --list-rules", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["--list-rules"]).listRules).toBe(true);
  });

  it("records unknown flags", () => {
    const a = parseArgs(["--nope"]);
    expect(a.unknown).toEqual(["--nope"]);
  });
});

describe("selectRules", () => {
  it("returns all rules when none requested", () => {
    expect(selectRules([])).toBe(RULES);
  });

  it("returns only the requested rule", () => {
    const selected = selectRules(["no-env-file-leakage"]);
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe("no-env-file-leakage");
  });

  it("throws on unknown rule id", () => {
    expect(() => selectRules(["nope"])).toThrow(/unknown rule/);
  });
});

describe("walk", () => {
  it("yields scannable files only", () => {
    writeFile("a.ts", "");
    writeFile("b.md", "");
    writeFile("c.mjs", "");
    writeFile("sub/d.tsx", "");
    writeFile("node_modules/skip.ts", "");
    writeFile("dist/skip.ts", "");

    const yielded = [...walk(tmpRoot)].map((p: string) =>
      path.relative(tmpRoot, p).replace(/\\/g, "/"),
    );
    yielded.sort();
    expect(yielded).toEqual(["a.ts", "c.mjs", "sub/d.tsx"]);
  });

  it("returns the single file when called on a file path", () => {
    const f = writeFile("only.ts", "");
    expect([...walk(f)].length).toBe(1);
  });

  it("returns nothing for a missing path", () => {
    expect([...walk(path.join(tmpRoot, "does-not-exist"))]).toEqual([]);
  });

  it("scans every documented extension", () => {
    for (const ext of SCANNED_EXTENSIONS) {
      writeFile(`x${ext}`, "");
    }
    const yielded = [...walk(tmpRoot)].map((p: string) =>
      path.relative(tmpRoot, p).replace(/\\/g, "/"),
    );
    expect(yielded.length).toBe(SCANNED_EXTENSIONS.size);
  });
});

describe("scanPath", () => {
  it("aggregates findings across files", () => {
    writeFile("src/a.ts", `readFile(".env");`);
    writeFile("src/b.ts", "console.log('debug');\n");
    const findings = scanPath(tmpRoot, RULES);
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// End-to-end spawn tests
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN_PATH, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

describe("gemma-check CLI (spawn)", () => {
  it("exits 0 and prints help with --help", async () => {
    const r = await runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("gemma-check");
  });

  it("exits 0 and prints rule ids with --list-rules", async () => {
    const r = await runCli(["--list-rules"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no-secret-patterns");
  });

  it("exits 0 on a warning-only finding (default semantics)", async () => {
    // v0.8.0 Phase 7 post-CI: the CLI no longer gates on warnings.
    // `no-committed-console-log` is severity=warning, so the leak is
    // reported on stdout but the exit code stays 0. Use --strict to
    // restore the legacy any-finding-fails behaviour.
    writeFile("src/leaky.ts", "console.log('hi');\n");
    const r = await runCli([tmpRoot]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no-committed-console-log");
  });

  it("exits 1 when an error-severity finding fires", async () => {
    // `no-secret-patterns` is severity=error, so the leak gates the build.
    writeFile(
      "src/auth/secret.ts",
      `export const KEY = "AKIAIOSFODNN7EXAMPLE";\n`,
    );
    const r = await runCli([tmpRoot]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("no-secret-patterns");
  });

  it("--strict flips warning-only findings to a failing exit", async () => {
    writeFile("src/leaky.ts", "console.log('hi');\n");
    const r = await runCli(["--strict", tmpRoot]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("no-committed-console-log");
  });

  it("exits 0 on a clean tree", async () => {
    writeFile("src/clean.ts", "export const X = 1;\n");
    const r = await runCli([tmpRoot]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("0 findings");
  });

  it("emits a JSON envelope with --json", async () => {
    writeFile("src/leaky.ts", `const k = "ghp_${"a".repeat(36)}";`);
    const r = await runCli(["--json", tmpRoot]);
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].rule).toBe("no-secret-patterns");
  });

  it("exits 2 on unknown flag", async () => {
    const r = await runCli(["--nope"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("--nope");
  });

  it("exits 2 on a missing path", async () => {
    const r = await runCli([path.join(tmpRoot, "does-not-exist")]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("path not found");
  });

  it("scopes to a single rule with --rule", async () => {
    writeFile("src/leaky.ts", "console.log('a');\n");
    writeFile("src/secret.ts", `const k = "ghp_${"a".repeat(36)}";`);
    const r = await runCli(["--rule", "no-secret-patterns", tmpRoot]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("no-secret-patterns");
    expect(r.stdout).not.toContain("no-committed-console-log");
  });
});
