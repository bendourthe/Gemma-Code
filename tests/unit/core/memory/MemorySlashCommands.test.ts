import { describe, it, expect, beforeEach } from "vitest";
import {
  handleRecall,
  handleRemember,
  handleForget,
  parseForgetArgs,
  type SlashCommandContext,
  type MemoryWritePort,
  type ForgetEntry,
} from "../../../../core/memory/MemorySlashCommands.js";
import {
  InMemoryAuditLog,
  type MemoryAuditLog,
} from "../../../../core/memory/MemoryAuditLog.js";
import type {
  HybridRetrieverLike,
  MemoryHit,
} from "../../../../core/memory/MemoryHub.js";

class FakeRetriever implements HybridRetrieverLike {
  isReady = true;
  hits: MemoryHit[] = [];
  async retrieve(_query: string, opts?: { limit?: number }): Promise<MemoryHit[]> {
    return this.hits.slice(0, opts?.limit ?? 10);
  }
}

class FakeMemory implements MemoryWritePort {
  written: Array<{ content: string; id: string }> = [];
  rows: ForgetEntry[] = [];
  deleted: string[] = [];
  nextId = 1;

  async writeWorking(args: { content: string }): Promise<{ id: string }> {
    const id = `id-${this.nextId++}`;
    this.written.push({ content: args.content, id });
    return { id };
  }

  async listForForget(): Promise<readonly ForgetEntry[]> {
    return this.rows.slice();
  }

  async delete(id: string): Promise<boolean> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    this.deleted.push(id);
    return true;
  }
}

function makeContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    sessionId: "session-test",
    retriever: new FakeRetriever(),
    memory: new FakeMemory(),
    auditLog: new InMemoryAuditLog(),
    confirm: async () => true,
    ...overrides,
  };
}

describe("handleRecall", () => {
  it("returns hits from the retriever as a fenced JSON block and writes audit reads", async () => {
    const retriever = new FakeRetriever();
    retriever.hits = [
      {
        id: "h1",
        layer: "working",
        content: "Use Python pathlib for path operations",
        score: 0.83,
      },
      {
        id: "h2",
        layer: "semantic",
        content: "Always use ruff format",
        score: 0.55,
      },
    ];
    const auditLog: MemoryAuditLog = new InMemoryAuditLog();
    const ctx = makeContext({ retriever, auditLog });
    const result = await handleRecall("/recall Python", ctx);
    expect(result.ok).toBe(true);
    expect(result.body).toContain("```json");
    expect(result.body).toContain("Use Python pathlib");
    expect(auditLog.size()).toBe(2);
    const auditRows = auditLog.query();
    expect(auditRows.every((r) => r.op === "read")).toBe(true);
    expect(auditRows[0]?.hookKind).toBe("slash.recall");
  });

  it("rejects empty queries", async () => {
    const result = await handleRecall("/recall   ", makeContext());
    expect(result.ok).toBe(false);
    expect(result.status).toContain("missing query");
  });

  it("rejects when retriever is missing", async () => {
    const result = await handleRecall("/recall hello", makeContext({ retriever: null }));
    expect(result.ok).toBe(false);
    expect(result.status).toContain("not initialized");
  });

  it("rejects when retriever is still warming up", async () => {
    const r = new FakeRetriever();
    r.isReady = false;
    const result = await handleRecall("/recall hello", makeContext({ retriever: r }));
    expect(result.ok).toBe(false);
    expect(result.status).toContain("warming up");
  });
});

describe("handleRemember", () => {
  it("writes a working-tier observation with slash.remember provenance", async () => {
    const memory = new FakeMemory();
    const auditLog = new InMemoryAuditLog();
    const ctx = makeContext({ memory, auditLog });
    const result = await handleRemember("/remember Always use ruff", ctx);
    expect(result.ok).toBe(true);
    expect(memory.written).toHaveLength(1);
    expect(memory.written[0]?.content).toBe("Always use ruff");
    expect(auditLog.size()).toBe(1);
    expect(auditLog.query()[0]?.hookKind).toBe("slash.remember");
    expect(auditLog.query()[0]?.op).toBe("write");
  });

  it("rejects empty text", async () => {
    const result = await handleRemember("/remember   ", makeContext());
    expect(result.ok).toBe(false);
    expect(result.status).toContain("missing text");
  });
});

describe("parseForgetArgs", () => {
  it("parses --id", () => {
    expect(parseForgetArgs("/forget --id abc-123")).toEqual({ id: "abc-123" });
    expect(parseForgetArgs("/forget --id=abc-123")).toEqual({ id: "abc-123" });
  });

  it("parses --pattern bare", () => {
    const r = parseForgetArgs("/forget --pattern test");
    expect(r?.pattern).toBeInstanceOf(RegExp);
    expect(r?.pattern?.source).toBe("test");
  });

  it("parses --pattern quoted", () => {
    const r = parseForgetArgs('/forget --pattern "ruff format"');
    expect(r?.pattern?.test("ruff format")).toBe(true);
  });

  it("returns null without flags", () => {
    expect(parseForgetArgs("/forget hello")).toBeNull();
  });

  it("returns null for invalid regex", () => {
    expect(parseForgetArgs("/forget --pattern [unclosed")).toBeNull();
  });
});

describe("handleForget", () => {
  let memory: FakeMemory;
  let auditLog: InMemoryAuditLog;
  beforeEach(() => {
    memory = new FakeMemory();
    auditLog = new InMemoryAuditLog();
    memory.rows = [
      { id: "uuid-aaa", text: "alpha test memory", tier: "working" },
      { id: "uuid-bbb", text: "beta test memory", tier: "semantic" },
      { id: "uuid-ccc", text: "no match here", tier: "working" },
    ];
  });

  it("--id deletes one row after confirmation", async () => {
    const ctx = makeContext({ memory, auditLog });
    const result = await handleForget("/forget --id uuid-aaa", ctx);
    expect(result.ok).toBe(true);
    expect(memory.deleted).toEqual(["uuid-aaa"]);
    expect(auditLog.size()).toBe(1);
    expect(auditLog.query()[0]?.op).toBe("delete");
  });

  it("--pattern deletes every matching row", async () => {
    const ctx = makeContext({ memory, auditLog });
    const result = await handleForget("/forget --pattern test", ctx);
    expect(result.ok).toBe(true);
    expect(memory.deleted.sort()).toEqual(["uuid-aaa", "uuid-bbb"]);
    expect(auditLog.size()).toBe(2);
  });

  it("cancellation leaves the rows untouched", async () => {
    const ctx = makeContext({ memory, auditLog, confirm: async () => false });
    const result = await handleForget("/forget --pattern test", ctx);
    expect(result.ok).toBe(false);
    expect(result.status).toContain("cancelled");
    expect(memory.deleted).toEqual([]);
    expect(auditLog.size()).toBe(0);
  });

  it("rejects when neither --id nor --pattern is supplied", async () => {
    const result = await handleForget("/forget", makeContext({ memory, auditLog }));
    expect(result.ok).toBe(false);
    expect(result.status).toContain("missing --id or --pattern");
  });

  it("reports no-match cleanly", async () => {
    const ctx = makeContext({ memory, auditLog });
    const result = await handleForget("/forget --id missing", ctx);
    expect(result.ok).toBe(false);
    expect(result.status).toContain("no matching");
  });
});
