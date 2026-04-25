import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";
import {
  parseMemoryLintArgs,
  runMemoryLint,
} from "../../../src/commands/memoryLintCommand.js";

describe("parseMemoryLintArgs", () => {
  it("defaults to mode=default with no flags", () => {
    expect(parseMemoryLintArgs("")).toEqual({
      mode: "default",
      limit: undefined,
      full: false,
    });
  });

  it("parses --dry-run as a distinct mode flag", () => {
    expect(parseMemoryLintArgs("--dry-run").mode).toBe("dry-run");
  });

  it("parses --apply", () => {
    expect(parseMemoryLintArgs("--apply").mode).toBe("apply");
  });

  it("parses --help", () => {
    expect(parseMemoryLintArgs("--help").mode).toBe("help");
  });

  it("parses --full and --limit=N", () => {
    expect(parseMemoryLintArgs("--full")).toMatchObject({ full: true });
    expect(parseMemoryLintArgs("--limit=42")).toMatchObject({ limit: 42 });
  });
});

describe("runMemoryLint", () => {
  let store: MemoryStore;
  let workspaceRoot: string;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-lint-cmd-"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("--dry-run produces the same report as the default", async () => {
    await store.save("a fact", "fact");
    const def = await runMemoryLint(parseMemoryLintArgs(""), {
      memoryStore: store,
      workspaceRoot,
    });
    const dry = await runMemoryLint(parseMemoryLintArgs("--dry-run"), {
      memoryStore: store,
      workspaceRoot,
    });
    expect(def.report?.counts.totalEntries).toBe(dry.report?.counts.totalEntries);
    expect(def.report?.issues.stale.length).toBe(dry.report?.issues.stale.length);
  });

  it("--apply returns the structured 'not yet supported' message", async () => {
    const result = await runMemoryLint(parseMemoryLintArgs("--apply"), {
      memoryStore: store,
      workspaceRoot,
    });
    expect(result.mode).toBe("apply");
    expect(result.message).toContain("not yet supported");
    // The error must reference /memory prune so future readers can grep for
    // the planned destructive command name.
    expect(result.message).toContain("/memory prune");
    // Apply must NOT write the report.
    expect(result.report).toBeUndefined();
    expect(result.reportPath).toBeUndefined();
  });

  it("--help returns help text without writing a report", async () => {
    const result = await runMemoryLint(parseMemoryLintArgs("--help"), {
      memoryStore: store,
      workspaceRoot,
    });
    expect(result.mode).toBe("help");
    expect(result.message.toLowerCase()).toContain("memory lint");
    expect(result.report).toBeUndefined();
  });

  it("default mode writes .gemma-code/memory-health.md", async () => {
    await store.save("a fact", "fact");
    const result = await runMemoryLint(parseMemoryLintArgs(""), {
      memoryStore: store,
      workspaceRoot,
    });
    expect(result.reportPath).toBeDefined();
    expect(fs.existsSync(result.reportPath!)).toBe(true);
    expect(result.message).toContain("memory-health.md");
  });
});
