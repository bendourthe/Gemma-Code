/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- persisted-session
 * size-delta benchmark.
 *
 * The plan's acceptance asks for "a benchmark [that] records the
 * persisted-session size delta." This builds a representative session whose
 * turns carry large captured fields (a build log, a unified diff, a stack
 * trace) and measures the persisted JSON size before (fully inline) vs after
 * (dehydrated to the content-addressed artifact store). The delta is written
 * to a results fixture so the cycle docs can cite a real artifact, and the
 * dehydrated form is asserted to be materially smaller.
 *
 * Deterministic: the corpus is generated from fixed seeds (no Math.random), so
 * a re-run produces the same numbers.
 *
 * Results are written to:
 *   tests/fixtures/session-dehydration/2026-06-15/results.json
 */

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArtifactStore } from "../../../core/memory/ArtifactStore.js";
import { dehydrateMessages } from "../../../core/memory/sessionArtifacts.js";

const RESULTS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "fixtures",
  "session-dehydration",
  "2026-06-15",
);

/** A representative oversized turn-content corpus (deterministic). */
function buildMessages(): string[] {
  const buildLog = Array.from(
    { length: 1_200 },
    (_, i) => `[build] compiling module-${i % 40} step ${i} ... ok`,
  ).join("\n");
  const diff = ["diff --git a/src/x.ts b/src/x.ts", "@@ -1,3 +1,3 @@"]
    .concat(
      Array.from({ length: 1_200 }, (_, i) =>
        i % 2
          ? `+added line ${i} of changed content under review`
          : `-removed line ${i} of changed content under review`,
      ),
    )
    .join("\n");
  const stack = Array.from(
    { length: 800 },
    (_, i) => `    at frame_${i} (/repo/src/file-${i % 30}.ts:${i}:${i % 80})`,
  ).join("\n");
  return [
    "run the build and fix the failing test", // small user turn, stays inline
    buildLog,
    diff,
    stack,
  ];
}

describe("Phase 3 session-state dehydration size benchmark", () => {
  it("dehydrated persisted size is materially smaller than inline", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-dehydration-bench-"));
    try {
      const store = new ArtifactStore(path.join(tmp, "session-artifacts"));
      const messages = buildMessages();

      const inlineBytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
      const dehydrated = dehydrateMessages(messages, store);
      const dehydratedBytes = Buffer.byteLength(JSON.stringify(dehydrated), "utf8");

      const ratio = dehydratedBytes / inlineBytes;
      const markerCount = dehydrated.filter((m) => typeof m !== "string").length;

      await fs.mkdir(RESULTS_DIR, { recursive: true });
      const summary = {
        runAt: "2026-06-15",
        turns: messages.length,
        fieldsDehydrated: markerCount,
        thresholdBytes: 20 * 1024,
        inlinePersistedBytes: inlineBytes,
        dehydratedPersistedBytes: dehydratedBytes,
        sizeRatio: Number(ratio.toFixed(4)),
        sizeReductionPercent: `${((1 - ratio) * 100).toFixed(2)}%`,
        stabilityGate: { sizeRatioMax: 0.5 },
      };
      await fs.writeFile(
        path.join(RESULTS_DIR, "results.json"),
        JSON.stringify(summary, null, 2),
        "utf-8",
      );

      // Three of the four turns exceed the 20KB threshold and dehydrate.
      expect(markerCount).toBe(3);
      // The persisted JSON shrinks to a small fraction of the inline size.
      expect(ratio).toBeLessThanOrEqual(0.5);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
