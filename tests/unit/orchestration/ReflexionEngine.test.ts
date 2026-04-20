import { describe, it, expect, vi } from "vitest";
import { ReflexionEngine } from "../../../src/orchestration/ReflexionEngine.js";
import type { Reflection } from "../../../src/orchestration/ReflexionEngine.js";
import {
  makeFailedTaskNode as makeNode,
  makeMemoryStore,
  makeOllamaClient as makeClient,
} from "../../helpers/factories.js";

const ollamaOptions = { num_ctx: 131072, temperature: 1.0 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReflexionEngine", () => {
  describe("reflect", () => {
    it("generate a reflection from the LLM", async () => {
      const analysis =
        "The file path was incorrect. Do not assume relative paths work from the project root. Ensure the full absolute path is used.";
      const client = makeClient(analysis);
      const engine = new ReflexionEngine(
        client,
        "gemma4:e4b",
        ollamaOptions,
        null,
      );

      const node = makeNode("task_1");
      const reflection = await engine.reflect(
        node,
        "ENOENT: file not found",
        "Trying to read src/utils.ts",
      );

      expect(reflection.taskId).toBe("task_1");
      expect(reflection.analysis).toBe(analysis);
      expect(reflection.timestamp).toBeGreaterThan(0);
      expect(client.streamChat).toHaveBeenCalledTimes(1);
    });

    it("extract constraints from the analysis", async () => {
      const analysis =
        "The function was not found because the module was renamed. Do not use the old module path. Avoid hardcoding file names. Instead, use the grep tool to find the current location. Make sure to verify the file exists before reading it.";
      const client = makeClient(analysis);
      const engine = new ReflexionEngine(
        client,
        "gemma4:e4b",
        ollamaOptions,
        null,
      );

      const reflection = await engine.reflect(
        makeNode("task_1"),
        "Module not found",
        "Importing old_module",
      );

      expect(reflection.constraints.length).toBeGreaterThanOrEqual(2);
      expect(
        reflection.constraints.some((c) => c.includes("Do not")),
      ).toBe(true);
    });

    it("return empty constraints when no patterns match", async () => {
      const analysis = "The error occurred because of a network timeout. The server was unreachable.";
      const client = makeClient(analysis);
      const engine = new ReflexionEngine(
        client,
        "gemma4:e4b",
        ollamaOptions,
        null,
      );

      const reflection = await engine.reflect(
        makeNode("task_1"),
        "Timeout",
        "Fetching resource",
      );

      expect(reflection.constraints).toEqual([]);
    });
  });

  describe("storeReflection", () => {
    it("save to memory store as error_resolution type", async () => {
      const memoryStore = makeMemoryStore();
      const client = makeClient("analysis");
      const engine = new ReflexionEngine(
        client,
        "gemma4:e4b",
        ollamaOptions,
        memoryStore,
      );

      const reflection: Reflection = {
        taskId: "task_1",
        analysis: "The file was missing.",
        constraints: ["Do not assume files exist."],
        timestamp: Date.now(),
      };

      await engine.storeReflection(reflection, "session_123");

      expect(memoryStore.save).toHaveBeenCalledWith(
        "The file was missing.",
        "error_resolution",
        "session_123",
      );
    });

    it("not throw when memory store is null", async () => {
      const client = makeClient("analysis");
      const engine = new ReflexionEngine(
        client,
        "gemma4:e4b",
        ollamaOptions,
        null,
      );

      const reflection: Reflection = {
        taskId: "task_1",
        analysis: "Error analysis",
        constraints: [],
        timestamp: Date.now(),
      };

      await expect(engine.storeReflection(reflection)).resolves.toBeUndefined();
    });
  });

  describe("buildRetryContext", () => {
    it("format a single reflection", () => {
      const client = makeClient("");
      const engine = new ReflexionEngine(
        client,
        "gemma4:e4b",
        ollamaOptions,
        null,
      );

      const reflections: Reflection[] = [
        {
          taskId: "task_1",
          analysis: "File path was wrong.",
          constraints: ["Do not use relative paths."],
          timestamp: Date.now(),
        },
      ];

      const context = engine.buildRetryContext(reflections);
      expect(context).toContain("## Previous Attempt Failures");
      expect(context).toContain("Attempt 1: File path was wrong.");
      expect(context).toContain("Do not use relative paths.");
    });

    it("format multiple reflections", () => {
      const client = makeClient("");
      const engine = new ReflexionEngine(
        client,
        "gemma4:e4b",
        ollamaOptions,
        null,
      );

      const reflections: Reflection[] = [
        {
          taskId: "task_1",
          analysis: "First error.",
          constraints: ["Avoid X."],
          timestamp: Date.now(),
        },
        {
          taskId: "task_1",
          analysis: "Second error.",
          constraints: [],
          timestamp: Date.now(),
        },
      ];

      const context = engine.buildRetryContext(reflections);
      expect(context).toContain("Attempt 1: First error.");
      expect(context).toContain("Attempt 2: Second error.");
    });

    it("return empty string for no reflections", () => {
      const client = makeClient("");
      const engine = new ReflexionEngine(
        client,
        "gemma4:e4b",
        ollamaOptions,
        null,
      );

      expect(engine.buildRetryContext([])).toBe("");
    });
  });
});
