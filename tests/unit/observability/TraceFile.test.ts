import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TraceFile, defaultTracePath } from "../../../src/observability/TraceFile.js";

describe("TraceFile", () => {
  let tmpDir: string;
  let target: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tracefile-"));
    target = path.join(tmpDir, "trace.jsonl");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tolerated on Windows */
    }
  });

  it("starts disabled and emits no file before enable()", () => {
    const tf = new TraceFile();
    expect(tf.enabled).toBe(false);
    tf.append({ kind: "tool_call", attributes: { tool: "read" } });
    expect(fs.existsSync(target)).toBe(false);
  });

  it("writes JSONL lines while enabled", () => {
    const tf = new TraceFile();
    tf.enable(target);
    tf.append({
      kind: "tool_call",
      attributes: { tool: "read", path: "src/index.ts" },
      timestamp: 0,
    });
    tf.append({
      kind: "compaction",
      attributes: { droppedTokens: 1234 },
      timestamp: 1,
    });
    const lines = fs.readFileSync(target, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.kind).toBe("tool_call");
    expect(parsed.tool).toBe("read");
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("redacts secret-shaped values by key heuristic", () => {
    const tf = new TraceFile();
    tf.enable(target);
    tf.append({
      kind: "tool_call",
      attributes: { api_key: "sk-abc-123", token: "xyz", innocuous: "ok" },
    });
    const parsed = JSON.parse(fs.readFileSync(target, "utf8").trim());
    expect(parsed.api_key).toBe("<redacted>");
    expect(parsed.token).toBe("<redacted>");
    expect(parsed.innocuous).toBe("ok");
  });

  it("redacts paths that match the secretPaths denylist", () => {
    const tf = new TraceFile();
    tf.enable(target);
    tf.append({
      kind: "tool_call",
      attributes: { path: "config/.env.local", other: "src/index.ts" },
    });
    const parsed = JSON.parse(fs.readFileSync(target, "utf8").trim());
    expect(parsed.path).toBe("<redacted>");
    expect(parsed.other).toBe("src/index.ts");
  });

  it("redacts embedded env-style secret values", () => {
    const tf = new TraceFile();
    tf.enable(target);
    tf.append({
      kind: "system_prompt",
      attributes: { body: "API_KEY=abcdef123456ABCDEF and other text" },
    });
    const parsed = JSON.parse(fs.readFileSync(target, "utf8").trim());
    expect(parsed.body).toContain("<env=<redacted>>");
    expect(parsed.body).not.toContain("abcdef123456ABCDEF");
  });

  it("dump copies the active trace to a target path", () => {
    const tf = new TraceFile();
    tf.enable(target);
    tf.append({ kind: "tool_call", attributes: { tool: "read" } });
    const dest = path.join(tmpDir, "dump.jsonl");
    const written = tf.dump(dest);
    expect(written).toBe(dest);
    expect(fs.readFileSync(dest, "utf8")).toEqual(fs.readFileSync(target, "utf8"));
  });

  it("dump throws when no trace file is active", () => {
    const tf = new TraceFile();
    expect(() => tf.dump(path.join(tmpDir, "x"))).toThrowError(/no active/);
  });

  it("clear removes the on-disk file and resets count", () => {
    const tf = new TraceFile();
    tf.enable(target);
    tf.append({ kind: "tool_call", attributes: { tool: "read" } });
    expect(fs.existsSync(target)).toBe(true);
    tf.clear();
    expect(fs.existsSync(target)).toBe(false);
    expect(tf.stats().eventCount).toBe(0);
  });

  it("stats reports enabled state and file size", () => {
    const tf = new TraceFile();
    expect(tf.stats().enabled).toBe(false);
    tf.enable(target);
    tf.append({ kind: "tool_call", attributes: {} });
    const stats = tf.stats();
    expect(stats.enabled).toBe(true);
    expect(stats.filePath).toBe(target);
    expect(stats.fileSizeBytes).toBeGreaterThan(0);
    expect(stats.eventCount).toBe(1);
  });

  it("defaultTracePath places the file under the user's home directory", () => {
    const p = defaultTracePath("abc123");
    expect(p).toContain(".nexus");
    expect(p).toContain("abc123");
  });
});
