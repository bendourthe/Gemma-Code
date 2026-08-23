import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { getSharedAudioRuntime, resetSharedAudioRuntime } from "./audio/sharedRuntime";
import { getSharedOcrRuntime, resetSharedOcrRuntime } from "./ocr/sharedRuntime";
import { createGoldenEvalPort } from "./tuning/goldenEvalPort";
import { createOllamaCreatePort } from "./tuning/ollamaImport";

describe("createGoldenEvalPort", () => {
  it("scores the injected task runner without touching disk", async () => {
    const port = createGoldenEvalPort({
      tasksDir: "/tasks",
      loadTasks: () => [{ id: "t1" } as never],
      runTask: async () => ({ passed: true }),
    });
    expect(await port.score("model-a")).toBe(1);
  });

  it("returns 0 when no tasks load", async () => {
    const port = createGoldenEvalPort({ tasksDir: "" });
    expect(await port.score("model-a")).toBe(0);
  });
});

describe("createOllamaCreatePort", () => {
  it("writes a Modelfile and resolves when ollama exits 0", async () => {
    const spawnFn = ((_cmd: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const port = createOllamaCreatePort(spawnFn);
    await expect(port.importGguf("/tmp/m.gguf", "my-model")).resolves.toBeUndefined();
  });
});

describe("shared audio and ocr runtimes", () => {
  it("return an injected override and reset the memoized handle", () => {
    const audio = { id: "audio" } as never;
    const ocr = { id: "ocr" } as never;
    expect(getSharedAudioRuntime(audio)).toBe(audio);
    expect(getSharedOcrRuntime(ocr)).toBe(ocr);
    resetSharedAudioRuntime();
    resetSharedOcrRuntime();
  });
});
