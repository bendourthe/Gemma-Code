/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- session message
 * dehydration / hydration unit tests.
 *
 * Coverage:
 *   - below-threshold strings pass through unchanged
 *   - above-threshold strings become markers; full content round-trips
 *   - re-dehydration is idempotent (markers pass through)
 *   - a missing artifact degrades to the inline preview (no throw)
 *   - preview is redacted, whitespace-collapsed, and truncated
 *   - classifyKind: diff / patch / stderr / content
 *   - isDehydratedArtifact type guard
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArtifactStore } from "../../../../core/memory/ArtifactStore.js";
import {
  DEFAULT_DEHYDRATION_THRESHOLD_BYTES,
  classifyKind,
  dehydrateMessages,
  hydrateMessages,
  isDehydratedArtifact,
  type PersistedMessage,
} from "../../../../core/memory/sessionArtifacts.js";

let tmpDir = "";
let store: ArtifactStore;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-session-artifacts-"));
  store = new ArtifactStore(tmpDir);
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const big = (n: number = DEFAULT_DEHYDRATION_THRESHOLD_BYTES + 1) => "z".repeat(n);

describe("dehydrateMessages / hydrateMessages", () => {
  it("passes small messages through unchanged", () => {
    const messages = ["hello", "world"];
    const out = dehydrateMessages(messages, store);
    expect(out).toEqual(["hello", "world"]);
    expect(hydrateMessages(out, store)).toEqual(["hello", "world"]);
  });

  it("dehydrates a large message into a marker and round-trips it", () => {
    const payload = big();
    const out = dehydrateMessages(["small", payload], store);
    expect(out[0]).toBe("small");
    const marker = out[1];
    expect(isDehydratedArtifact(marker)).toBe(true);
    if (!isDehydratedArtifact(marker)) throw new Error("expected marker");
    expect(marker.nexusArtifact).toBe(1);
    expect(marker.artifact_ref).toMatch(/^[0-9a-f]{64}$/);
    expect(marker.bytes).toBe(payload.length);
    // Full content rehydrates.
    expect(hydrateMessages(out, store)).toEqual(["small", payload]);
  });

  it("is idempotent: re-dehydrating a marker is a no-op", () => {
    const out1 = dehydrateMessages([big()], store);
    const out2 = dehydrateMessages(out1, store);
    expect(out2).toEqual(out1);
    expect(hydrateMessages(out2, store)[0]).toBe(big());
  });

  it("respects a custom threshold", () => {
    const out = dehydrateMessages(["abcdef"], store, { thresholdBytes: 3 });
    expect(isDehydratedArtifact(out[0])).toBe(true);
  });

  it("degrades to the inline preview when the artifact is missing", () => {
    const out = dehydrateMessages([big()], store);
    const marker = out[0];
    if (!isDehydratedArtifact(marker)) throw new Error("expected marker");
    // Point at a non-existent artifact (simulating a pruned / deleted blob).
    const broken: PersistedMessage = { ...marker, artifact_ref: "f".repeat(64) };
    const hydrated = hydrateMessages([broken], store);
    expect(hydrated[0]).toBe(marker.preview);
  });

  it("builds a redacted, collapsed, truncated preview", () => {
    const secret = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    // Exceed the 20KB threshold so the field dehydrates; the secret sits near
    // the start so it lands inside the truncated preview window.
    const payload = `line one\n   ${secret}   \n` + "tail ".repeat(5_000);
    const out = dehydrateMessages([payload], store);
    const marker = out[0];
    if (!isDehydratedArtifact(marker)) throw new Error("expected marker");
    expect(marker.preview).not.toContain(secret);
    expect(marker.preview).not.toContain("\n");
    expect(marker.preview.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(marker.preview.endsWith("...")).toBe(true);
  });
});

describe("classifyKind", () => {
  it("classifies a git patch", () => {
    expect(classifyKind("diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b")).toBe("patch");
  });

  it("classifies a unified diff without a git header", () => {
    expect(classifyKind("@@ -1,2 +1,2 @@\n-old\n+new")).toBe("diff");
    expect(classifyKind("--- a/file\n+++ b/file\n@@ -1 +1 @@")).toBe("diff");
  });

  it("classifies stderr-ish output", () => {
    expect(classifyKind("Error: something exploded")).toBe("stderr");
    expect(classifyKind("    at fn (/path/to/file.js:10:5)")).toBe("stderr");
  });

  it("defaults to content", () => {
    expect(classifyKind("just some ordinary prose output")).toBe("content");
  });
});

describe("isDehydratedArtifact", () => {
  it("rejects non-markers", () => {
    expect(isDehydratedArtifact("string")).toBe(false);
    expect(isDehydratedArtifact(null)).toBe(false);
    expect(isDehydratedArtifact(42)).toBe(false);
    expect(isDehydratedArtifact({ artifact_ref: "x" })).toBe(false);
  });

  it("accepts a well-formed marker", () => {
    expect(
      isDehydratedArtifact({
        nexusArtifact: 1,
        artifact_ref: "a".repeat(64),
        preview: "p",
        kind: "content",
        bytes: 1,
      }),
    ).toBe(true);
  });
});
