import { describe, it, expect } from "vitest";
import { CompressionState } from "../../../../modules/coding/chat/state/CompressionState.js";
import type { Message } from "../../../../modules/coding/chat/types.js";

function msg(id: string, content = id): Message {
  return { id, role: "user", content, timestamp: 1 };
}

describe("CompressionState", () => {
  it("allocates monotonic stable IDs and reuses them", () => {
    const s = new CompressionState();
    const m1 = msg("uuid-1");
    const m2 = msg("uuid-2");
    expect(s.allocateMessageId(m1)).toBe("m0001");
    expect(s.allocateMessageId(m2)).toBe("m0002");
    expect(s.allocateMessageId(m1)).toBe("m0001"); // idempotent
    expect(s.allocateBlockId()).toBe("b1");
    expect(s.allocateBlockId()).toBe("b2");
  });

  it("records a run and lists it", () => {
    const s = new CompressionState();
    const snapshot = [msg("a"), msg("b")];
    s.recordRun({
      topic: "first",
      mode: "range",
      blockSummaries: [
        { blockId: "b1", startId: "m0001", endId: "m0002", summary: "...", nestedBlockIds: [], snapshot },
      ],
    });
    expect(s.runCount).toBe(1);
    const found = s.findBlock("b1");
    expect(found?.block.summary).toBe("...");
  });

  it("decompress returns the snapshot and marks the run decompressed", () => {
    const s = new CompressionState();
    const snapshot = [msg("a"), msg("b")];
    s.recordRun({
      topic: "first",
      mode: "range",
      blockSummaries: [
        { blockId: "b1", startId: "m0001", endId: "m0002", summary: "S", nestedBlockIds: [], snapshot },
      ],
    });
    const result = s.decompressBlock("b1");
    expect(result.restoredMessages).toHaveLength(2);
    expect(s.findBlock("b1")?.run.decompressed).toBe(true);
  });

  it("recompress reverses decompress", () => {
    const s = new CompressionState();
    const snapshot = [msg("a"), msg("b")];
    s.recordRun({
      topic: "first",
      mode: "range",
      blockSummaries: [
        { blockId: "b1", startId: "m0001", endId: "m0002", summary: "S", nestedBlockIds: [], snapshot },
      ],
    });
    s.decompressBlock("b1");
    const re = s.recompressBlock("b1");
    expect(re).toBeDefined();
    expect(s.findBlock("b1")?.run.decompressed).toBe(false);
  });

  it("manualOnly toggles", () => {
    const s = new CompressionState();
    expect(s.manualOnly).toBe(false);
    s.setManualOnly(true);
    expect(s.manualOnly).toBe(true);
  });

  it("serialise / deserialise round-trip preserves IDs and runs", () => {
    const s1 = new CompressionState();
    s1.allocateMessageId(msg("uuid-1"));
    s1.allocateBlockId();
    const snapshot = [msg("a")];
    s1.recordRun({
      topic: "rt",
      mode: "range",
      blockSummaries: [
        { blockId: "b1", startId: "m0001", endId: "m0001", summary: "X", nestedBlockIds: [], snapshot },
      ],
    });

    const blob = s1.serialise();
    const s2 = CompressionState.deserialise(blob);
    expect(s2.runCount).toBe(1);
    expect(s2.findBlock("b1")?.block.summary).toBe("X");
    // Next allocations must continue, not restart.
    expect(s2.allocateBlockId()).toBe("b2");
  });
});
