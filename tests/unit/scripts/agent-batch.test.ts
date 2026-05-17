/**
 * v0.9.0 Phase 5 sub-task 5.3 -- unit tests for the agent-batch orchestrator.
 *
 * Covers the pure logic so `npm test` does not need a worktree, gh, or any
 * agent CLI installed. Specifically:
 *
 *  - Zod schema acceptance + rejection (agent enum, dependsOn shape).
 *  - Overlap analysis: duplicates, missing deps, cycle detection.
 *  - Topological order: independent issues first, dependents after.
 *  - Dispatch table renderer prints the four expected columns.
 *  - Status formatter renders pending / running / done.
 *  - cli main: help / unknown command / unknown sub-command.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { safeParseSpec, parseSpec } from "../../../scripts/agent-batch/schema.mjs";
import {
  analyzeOverlap,
  detectDuplicateIssues,
  detectMissingDeps,
  detectCycles,
  formatOverlapReport,
} from "../../../scripts/agent-batch/overlap.mjs";
import {
  topologicalOrder,
  buildDispatchTable,
  formatDispatchTable,
} from "../../../scripts/agent-batch/launch.mjs";
import { formatStatusTable } from "../../../scripts/agent-batch/status.mjs";
import { main } from "../../../scripts/agent-batch/cli.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SAMPLE_SPEC_PATH = path.join(REPO_ROOT, "examples", "agent-batch.spec.json");

const baseSpec = {
  batchId: "test-batch",
  tasks: [
    { issue: 1, agent: "claude", dependsOn: [] },
    { issue: 2, agent: "codex", dependsOn: [] },
    { issue: 3, agent: "cursor", dependsOn: [1] },
  ],
};

describe("schema validation", () => {
  it("accepts the canonical sample spec on disk", () => {
    const raw = JSON.parse(fs.readFileSync(SAMPLE_SPEC_PATH, "utf8"));
    const r = safeParseSpec(raw);
    expect(r.success).toBe(true);
    expect(r.data?.tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects an unknown agent name", () => {
    const r = safeParseSpec({
      batchId: "x",
      tasks: [{ issue: 1, agent: "bogus", dependsOn: [] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative issue numbers", () => {
    const r = safeParseSpec({
      batchId: "x",
      tasks: [{ issue: -1, agent: "claude", dependsOn: [] }],
    });
    expect(r.success).toBe(false);
  });

  it("requires at least one task", () => {
    const r = safeParseSpec({ batchId: "x", tasks: [] });
    expect(r.success).toBe(false);
  });

  it("parseSpec returns the data on success", () => {
    const spec = parseSpec({
      batchId: "x",
      tasks: [{ issue: 7, agent: "claude" }],
    });
    expect(spec.batchId).toBe("x");
    expect(spec.tasks[0].issue).toBe(7);
    expect(spec.tasks[0].dependsOn).toEqual([]);
  });
});

describe("detectDuplicateIssues", () => {
  it("returns [] when issues are unique", () => {
    expect(detectDuplicateIssues(baseSpec)).toEqual([]);
  });

  it("flags repeated issue numbers", () => {
    const spec = {
      batchId: "x",
      tasks: [
        { issue: 1, agent: "claude", dependsOn: [] },
        { issue: 1, agent: "codex", dependsOn: [] },
      ],
    };
    expect(detectDuplicateIssues(spec)).toEqual([{ issue: 1, count: 2 }]);
  });
});

describe("detectMissingDeps", () => {
  it("returns [] when every dep is in the batch", () => {
    expect(detectMissingDeps(baseSpec)).toEqual([]);
  });

  it("flags dependsOn entries that are missing", () => {
    const spec = {
      batchId: "x",
      tasks: [
        { issue: 1, agent: "claude", dependsOn: [42] },
      ],
    };
    expect(detectMissingDeps(spec)).toEqual([{ issue: 1, missingDep: 42 }]);
  });
});

describe("detectCycles", () => {
  it("returns [] for a DAG", () => {
    expect(detectCycles(baseSpec)).toEqual([]);
  });

  it("detects a simple cycle", () => {
    const spec = {
      batchId: "x",
      tasks: [
        { issue: 1, agent: "claude", dependsOn: [2] },
        { issue: 2, agent: "codex", dependsOn: [1] },
      ],
    };
    const cycles = detectCycles(spec);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe("formatOverlapReport", () => {
  it("renders an empty-state line when nothing is wrong", () => {
    expect(formatOverlapReport(analyzeOverlap(baseSpec))).toMatch(/no overlap/);
  });

  it("renders duplicates / missing / cycles when present", () => {
    // Cycle on (1 -> 3 -> 4 -> 1); duplicate on #2; missing dep #99 from #5.
    // Distinct issue numbers per cycle node so the cycle detector does not
    // collapse with the duplicate-issue case.
    const spec = {
      batchId: "x",
      tasks: [
        { issue: 1, agent: "claude", dependsOn: [3] },
        { issue: 2, agent: "codex", dependsOn: [] },
        { issue: 2, agent: "cursor", dependsOn: [] },
        { issue: 3, agent: "claude", dependsOn: [4] },
        { issue: 4, agent: "codex", dependsOn: [1] },
        { issue: 5, agent: "cursor", dependsOn: [99] },
      ],
    };
    const out = formatOverlapReport(analyzeOverlap(spec));
    expect(out).toMatch(/Duplicate issues/);
    expect(out).toMatch(/Missing dependencies/);
    expect(out).toMatch(/Dependency cycles/);
    expect(out).toMatch(/#99/);
  });
});

describe("topologicalOrder", () => {
  it("places dependencies before dependents", () => {
    const order = topologicalOrder(baseSpec.tasks);
    const idx1 = order.indexOf(1);
    const idx3 = order.indexOf(3);
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx3).toBeGreaterThan(idx1);
  });

  it("returns all issues in the batch", () => {
    const order = topologicalOrder(baseSpec.tasks);
    expect(order.sort()).toEqual([1, 2, 3]);
  });
});

describe("buildDispatchTable", () => {
  it("returns tasks in dependency order with their fields intact", () => {
    const rows = buildDispatchTable(baseSpec);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.issue)).toEqual(expect.arrayContaining([1, 2, 3]));
    const lastTaskIssue = rows[rows.length - 1].issue;
    expect(lastTaskIssue).toBe(3);
  });
});

describe("formatDispatchTable", () => {
  it("emits the batchId / issue / agent / dependsOn / extraPrompt columns", () => {
    const rows = buildDispatchTable(baseSpec);
    const out = formatDispatchTable(baseSpec, rows);
    expect(out).toMatch(/batchId/);
    expect(out).toMatch(/issue/);
    expect(out).toMatch(/agent/);
    expect(out).toMatch(/dependsOn/);
    expect(out).toMatch(/extraPrompt/);
    expect(out).toMatch(/test-batch/);
    expect(out).toMatch(/#1/);
    expect(out).toMatch(/#3/);
  });
});

describe("formatStatusTable", () => {
  it("renders each task's resolved status", () => {
    const statuses = new Map([
      [1, "done"],
      [2, "running"],
      [3, "pending"],
    ]);
    const out = formatStatusTable(baseSpec, statuses);
    expect(out).toMatch(/done/);
    expect(out).toMatch(/running/);
    expect(out).toMatch(/pending/);
    expect(out).toMatch(/test-batch/);
  });
});

describe("cli main", () => {
  it("prints help on --help and exits 0", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "cli.mjs", "--help"]);
      expect(code).toBe(0);
      expect(written.join("")).toMatch(/gemma-code agent-batch runner/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });

  it("rejects an unknown sub-command with exit 2", async () => {
    const errs: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    const origOut = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stderr.write = (chunk: string) => {
      errs.push(String(chunk));
      return true;
    };
    // @ts-expect-error -- monkey-patch
    process.stdout.write = () => true;
    try {
      const code = await main(["node", "cli.mjs", "wat"]);
      expect(code).toBe(2);
      expect(errs.join("")).toMatch(/unknown command/);
    } finally {
      // @ts-expect-error -- restore
      process.stderr.write = origErr;
      // @ts-expect-error -- restore
      process.stdout.write = origOut;
    }
  });

  it("validate passes against the sample spec on disk", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    const cwdOriginal = process.cwd();
    try {
      process.chdir(REPO_ROOT);
      const code = await main([
        "node",
        "cli.mjs",
        "validate",
        "examples/agent-batch.spec.json",
      ]);
      expect(code).toBe(0);
      expect(written.join("")).toMatch(/ok: batchId=/);
    } finally {
      process.chdir(cwdOriginal);
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });
});
