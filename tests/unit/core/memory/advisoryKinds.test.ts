import { describe, expect, it } from "vitest";

import {
  ADVISORY_CONTEXT_PREFIX,
  InMemoryMemoryHub,
} from "../../../../core/memory/MemoryHub.js";
import { HybridRetriever } from "../../../../core/memory/HybridRetriever.js";
import { Bm25Index } from "../../../../core/memory/Bm25Index.js";
import { DenseIndex } from "../../../../core/memory/DenseIndex.js";
import { LocalEmbedder, hashEmbed } from "../../../../core/memory/LocalEmbedder.js";
import type { MemoryHit } from "../../../../core/memory/MemoryHub.js";
import { REDACTED } from "../../../../core/observability/redactSecrets.js";

function makeEntry(id: string, content: string): MemoryHit {
  return { id, layer: "semantic", content, score: 0 };
}

describe("advisory memory kinds", () => {
  it("stores lessons and procedures as labelled context after redaction", async () => {
    const hub = new InMemoryMemoryHub();
    await hub.upsertAdvisory({
      id: "l1",
      kind: "lesson",
      content: "Prefer local models. Token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD",
    });
    await hub.upsertAdvisory({
      id: "p1",
      kind: "procedure",
      content: "Run tests before commit",
    });
    const hits = await hub.retrieve("local models", { limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.advisoryKind).toBe("lesson");
    expect(hits[0]?.content.startsWith(ADVISORY_CONTEXT_PREFIX)).toBe(true);
    expect(hits[0]?.content).toContain(REDACTED);
    expect(hits[0]?.content).not.toContain("ghp_");
  });

  it("updates usefulness votes", async () => {
    const hub = new InMemoryMemoryHub();
    await hub.upsertAdvisory({ id: "l1", kind: "lesson", content: "vote me" });
    expect(await hub.voteAdvisory("l1", 1)).toBe(1);
    expect(await hub.voteAdvisory("l1", 1)).toBe(2);
    expect(await hub.voteAdvisory("l1", -1)).toBe(1);
    expect(await hub.voteAdvisory("missing", 1)).toBe(0);
    const workingOnly = await hub.retrieve("vote me", { layers: ["working"] });
    expect(workingOnly.every((h) => h.advisoryKind === undefined)).toBe(true);
    const hits = await hub.retrieve("vote me");
    expect(hits[0]?.votes).toBe(1);
  });

  it("merges advisory hits onto the hybrid retrieve path", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const entries = new Map<string, MemoryHit>();
    for (let i = 0; i < 5; i++) {
      const id = `h${i}`;
      const text = `python pathlib hybrid ${i}`;
      bm25.add(id, text);
      dense.add(id, hashEmbed(text));
      entries.set(id, makeEntry(id, text));
    }
    const retriever = new HybridRetriever({
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25,
      dense,
      entryProvider: (id) => entries.get(id),
    });
    const hub = new InMemoryMemoryHub({
      hybridRetriever: retriever,
      hybridMinCorpus: 3,
    });
    for (let i = 0; i < 5; i++) {
      hub.workingMemory.add({ id: `w${i}`, content: `python pathlib working ${i}` });
    }
    await hub.upsertAdvisory({
      id: "lesson-hybrid",
      kind: "lesson",
      content: "pathlib resolve prefers absolute paths",
    });
    const hits = await hub.retrieve("pathlib", { limit: 10 });
    expect(hits.some((h) => h.id === "lesson-hybrid")).toBe(true);
    const advisory = hits.find((h) => h.id === "lesson-hybrid");
    expect(advisory?.content.startsWith(ADVISORY_CONTEXT_PREFIX)).toBe(true);
  });
});
