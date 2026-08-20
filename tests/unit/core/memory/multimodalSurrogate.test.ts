import { describe, expect, it } from "vitest";

import { InMemoryMemoryHub } from "../../../../core/memory/MemoryHub.js";
import {
  multimodalSurrogate,
  recordMultimodalTurn,
} from "../../../../core/memory/multimodalSurrogate.js";

describe("multimodalSurrogate", () => {
  it("redacts secrets in the caption before anything is stored", () => {
    const text = multimodalSurrogate({
      id: "t1",
      prompt: "caption AKIAIOSFODNN7EXAMPLE please",
      kinds: ["image"],
      mime: "image/png",
    });
    expect(text).toContain("[multimodal image");
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).toContain("<redacted>");
    expect(multimodalSurrogate({ id: "t2", prompt: "  ", kinds: [] })).toContain("attachment");
  });
});

describe("recordMultimodalTurn", () => {
  it("indexes the surrogate so retrieve matches caption text, not bytes", async () => {
    const hub = new InMemoryMemoryHub();
    const content = await recordMultimodalTurn(hub.episodic, {
      id: "mm-1",
      prompt: "a tabby cat on a sofa",
      kinds: ["image"],
    });
    expect(content).toContain("tabby cat");
    const hits = await hub.retrieve("tabby cat", { layers: ["episodic"], limit: 5 });
    expect(hits.some((h) => h.id === "mm-1")).toBe(true);
    expect(hits.every((h) => !h.content.includes("iVBORw0KGgo"))).toBe(true);
  });
});
