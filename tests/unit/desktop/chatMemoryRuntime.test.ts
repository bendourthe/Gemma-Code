import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ChatMemoryRuntime } from "../../../desktop/sidecar/src/chat/memoryRuntime";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ChatMemoryRuntime", () => {
  it("persists redacted episodic rows and searches them after reopen", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "nexus-chat-memory-"));
    tempRoots.push(root);
    const dbPath = path.join(root, "memory.db");
    const first = new ChatMemoryRuntime(dbPath);
    await first.record({
      id: "turn-1",
      content: "User token ghp_abcdefghijklmnopqrstuvwxyz1234567890 and likes concise answers",
      source: "chat-turn",
      scopeId: "work",
    });
    first.close();

    const reopened = new ChatMemoryRuntime(dbPath);
    const result = await reopened.search({ query: "concise", scopeId: "work" });
    reopened.close();
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.id).toBe("turn-1");
    expect(result.hits[0]?.content).toContain("concise answers");
    expect(result.hits[0]?.content).not.toContain("ghp_");
  });

  it("keeps scoped searches isolated", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "nexus-chat-memory-"));
    tempRoots.push(root);
    const runtime = new ChatMemoryRuntime(path.join(root, "memory.db"));
    await runtime.record({ id: "a", content: "project phoenix note", scopeId: "alpha" });
    await runtime.record({ id: "b", content: "project phoenix note", scopeId: "beta" });
    const alpha = await runtime.search({ query: "phoenix", scopeId: "alpha" });
    runtime.close();
    expect(alpha.hits.map((hit) => hit.id)).toEqual(["a"]);
  });
});
