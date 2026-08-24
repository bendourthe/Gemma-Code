import { describe, it, expect } from "vitest";
import { createGoldenEvalPort } from "../../../desktop/sidecar/src/tuning/goldenEvalPort.js";

describe("createGoldenEvalPort", () => {
  it("scores as passed/total from GoldenTaskRunner results", async () => {
    const port = createGoldenEvalPort({
      tasksDir: "tasks",
      snapshotRoot: "snap",
      loadTasks: () =>
        [
          { id: "a" },
          { id: "b" },
        ] as never,
      runTask: async (spec) => ({ passed: spec.id === "a" }),
    });
    await expect(port.score("base")).resolves.toBe(0.5);
  });

  it("returns 0 when no tasks load", async () => {
    const port = createGoldenEvalPort({});
    await expect(port.score("base")).resolves.toBe(0);
  });
});
