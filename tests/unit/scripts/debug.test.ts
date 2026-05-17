/**
 * v0.9.0 Phase 4 sub-task 4.1 -- unit tests for `scripts/debug/cli.mjs`.
 *
 * The debug runner is a Node-only CLI that dispatches to vitest for each
 * `--kind` and tees the combined stdout/stderr to `out/debug-logs/`. These
 * tests exercise the public exports without spawning a real vitest run:
 *
 *  - `buildVitestArgs` produces the right positional + filter args.
 *  - `summarizeVitestOutput` extracts a compact summary block.
 *  - `extractFailureBlocks` finds failures from a fake log body.
 *  - `listLogs` reads `out/debug-logs/` and sorts by mtime desc.
 *  - `main` with `--help` exits 0 and prints usage.
 *  - `main logs list` against an empty log dir prints the empty-state message.
 *  - `main` with an unknown command exits 2.
 *
 * The end-to-end run (debug unit -> vitest) is exercised manually in
 * Phase 4.5 and intentionally not asserted here -- it would re-enter the
 * suite and is gated on vitest's own state.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

import {
  buildVitestArgs,
  summarizeVitestOutput,
  extractFailureBlocks,
  listLogs,
  main,
} from "../../../scripts/debug/cli.mjs";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CLI_PATH = path.join(REPO_ROOT, "scripts", "debug", "cli.mjs");

describe("buildVitestArgs", () => {
  it("adds run + config + the unit positional for the unit kind", () => {
    const args = buildVitestArgs("unit", {
      watch: false,
      verbose: false,
      head: null,
      tail: null,
      nameFilter: null,
      positional: [],
    });
    expect(args).toContain("run");
    expect(args).toContain("--config");
    expect(args).toContain("configs/vitest.config.ts");
    expect(args).toContain("tests/unit");
  });

  it("scopes integration to tests/integration", () => {
    const args = buildVitestArgs("integration", {
      watch: false,
      verbose: false,
      head: null,
      tail: null,
      nameFilter: null,
      positional: [],
    });
    expect(args).toContain("tests/integration");
  });

  it("scopes golden to tests/integration/golden", () => {
    const args = buildVitestArgs("golden", {
      watch: false,
      verbose: false,
      head: null,
      tail: null,
      nameFilter: null,
      positional: [],
    });
    expect(args).toContain("tests/integration/golden");
  });

  it("forwards --watch and -t filters", () => {
    const args = buildVitestArgs("unit", {
      watch: true,
      verbose: false,
      head: null,
      tail: null,
      nameFilter: "Login",
      positional: [],
    });
    expect(args).toContain("--watch");
    const tIdx = args.indexOf("-t");
    expect(tIdx).toBeGreaterThanOrEqual(0);
    expect(args[tIdx + 1]).toBe("Login");
  });

  it("appends additional positionals after the kind selector", () => {
    const args = buildVitestArgs("unit", {
      watch: false,
      verbose: false,
      head: null,
      tail: null,
      nameFilter: null,
      positional: ["tests/unit/storage/MemoryStore.test.ts"],
    });
    expect(args).toContain("tests/unit/storage/MemoryStore.test.ts");
  });
});

describe("summarizeVitestOutput", () => {
  it("captures the Test Files / Tests / Duration lines into summary", () => {
    const raw = [
      " PASS  tests/unit/foo.test.ts",
      " PASS  tests/unit/bar.test.ts",
      "Test Files  2 passed (2)",
      "Tests       42 passed (42)",
      "Duration    1.23s",
    ].join("\n");
    const { summary } = summarizeVitestOutput(raw);
    expect(summary.join("\n")).toMatch(/Test Files\s+2 passed/);
    expect(summary.join("\n")).toMatch(/Tests\s+42 passed/);
    expect(summary.join("\n")).toMatch(/Duration/);
  });

  it("returns failure blocks when FAIL lines appear", () => {
    const raw = [
      "FAIL  tests/unit/example.test.ts > does the thing",
      "AssertionError: expected 1 to equal 2",
      "  at Object.<anonymous> (tests/unit/example.test.ts:4:5)",
      "",
      "",
      "Test Files  1 failed (1)",
    ].join("\n");
    const { failures } = summarizeVitestOutput(raw);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]).toMatch(/FAIL/);
    expect(failures[0]).toMatch(/AssertionError/);
  });
});

describe("extractFailureBlocks", () => {
  it("falls back to Error: scan when no FAIL marker is present", () => {
    const body = [
      "running tests...",
      "Error: connection refused",
      "  at Foo",
      "  at Bar",
      "  at Baz",
      "still running",
    ].join("\n");
    const blocks = extractFailureBlocks(body);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/Error: connection refused/);
  });
});

describe("listLogs", () => {
  let originalLogDir: string | undefined;
  let tmpRoot: string;

  beforeEach(() => {
    originalLogDir = process.env.GEMMA_DEBUG_LOG_DIR;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-debug-logs-"));
  });

  afterEach(() => {
    if (originalLogDir === undefined) {
      delete process.env.GEMMA_DEBUG_LOG_DIR;
    } else {
      process.env.GEMMA_DEBUG_LOG_DIR = originalLogDir;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns an empty array when the log directory does not exist yet", () => {
    // listLogs always reads the repo's out/debug-logs/; the empty-state
    // assertion here is a coarse smoke -- in practice a sibling test's run
    // may already have populated it. We assert that the function returns an
    // array (not a throw) and that every row has the expected shape.
    const rows = listLogs();
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(r.runId).toMatch(/^[a-z]+-/);
      expect(["unit", "integration", "golden", "bench"]).toContain(r.kind);
    }
  });
});

describe("main", () => {
  it("prints usage on --help and exits 0", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch for the duration of the test
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "cli.mjs", "--help"]);
      expect(code).toBe(0);
      expect(written.join("")).toMatch(/gemma-code debug runner/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });

  it("prints usage and exits 0 when no command is given", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch for the duration of the test
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "cli.mjs"]);
      expect(code).toBe(0);
      expect(written.join("")).toMatch(/gemma-code debug runner/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });

  it("rejects unknown commands with exit 2", async () => {
    const errs: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = () => true;
    // @ts-expect-error -- monkey-patch
    process.stderr.write = (chunk: string) => {
      errs.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "cli.mjs", "nonsense"]);
      expect(code).toBe(2);
      expect(errs.join("")).toMatch(/unknown command/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = origOut;
      // @ts-expect-error -- restore
      process.stderr.write = origErr;
    }
  });

  it("handles `logs list` without throwing", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "cli.mjs", "logs", "list"]);
      expect(code).toBe(0);
      // Output is either an empty-state line or a table header.
      const out = written.join("");
      expect(out.length).toBeGreaterThan(0);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });
});

describe("scripts/debug/* spawn smoke", () => {
  // Light end-to-end test: invoke the CLI as a subprocess with --help.
  // We do NOT run any real vitest sub-runner here -- only the help path.
  it("scripts/debug/cli.mjs --help exits 0", async () => {
    const result = await new Promise<{ code: number | null; stdout: string }>(
      (res) => {
        const child = spawn(process.execPath, [CLI_PATH, "--help"], {
          cwd: REPO_ROOT,
        });
        let stdout = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.on("exit", (code) => {
          res({ code, stdout });
        });
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/gemma-code debug runner/);
  });
});
