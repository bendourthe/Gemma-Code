import { describe, it, expect, beforeEach } from "vitest";
import { WorkingMemory, createWorkingMemory } from "../../../src/storage/WorkingMemory.js";

describe("WorkingMemory", () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = createWorkingMemory();
  });

  describe("initial state", () => {
    it("starts with empty state", () => {
      const state = wm.getState();
      expect(state.currentTask).toBeNull();
      expect(state.openFiles).toEqual([]);
      expect(state.recentErrors).toEqual([]);
      expect(state.architecturalDecisions).toEqual([]);
      expect(state.activeGoals).toEqual([]);
      expect(state.scratchpad).toEqual({});
    });
  });

  describe("setCurrentTask()", () => {
    it("sets the current task", () => {
      wm.setCurrentTask("Implement auth module");
      expect(wm.getState().currentTask).toBe("Implement auth module");
    });

    it("clears the task when set to null", () => {
      wm.setCurrentTask("Some task");
      wm.setCurrentTask(null);
      expect(wm.getState().currentTask).toBeNull();
    });
  });

  describe("addOpenFile()", () => {
    it("adds a file to the open files list", () => {
      wm.addOpenFile("src/auth.ts");
      expect(wm.getState().openFiles).toEqual(["src/auth.ts"]);
    });

    it("deduplicates files", () => {
      wm.addOpenFile("src/auth.ts");
      wm.addOpenFile("src/auth.ts");
      expect(wm.getState().openFiles).toEqual(["src/auth.ts"]);
    });

    it("caps at 10 files, evicting oldest", () => {
      for (let i = 0; i < 12; i++) {
        wm.addOpenFile(`file${i}.ts`);
      }
      const files = wm.getState().openFiles;
      expect(files).toHaveLength(10);
      expect(files[0]).toBe("file2.ts");
      expect(files[9]).toBe("file11.ts");
    });
  });

  describe("removeOpenFile()", () => {
    it("removes an existing file", () => {
      wm.addOpenFile("src/a.ts");
      wm.addOpenFile("src/b.ts");
      wm.removeOpenFile("src/a.ts");
      expect(wm.getState().openFiles).toEqual(["src/b.ts"]);
    });

    it("does nothing for a file not in the list", () => {
      wm.addOpenFile("src/a.ts");
      wm.removeOpenFile("src/c.ts");
      expect(wm.getState().openFiles).toEqual(["src/a.ts"]);
    });
  });

  describe("addRecentError()", () => {
    it("adds an error entry with timestamp", () => {
      wm.addRecentError("src/main.ts", "TypeError: x is undefined");
      const errors = wm.getState().recentErrors;
      expect(errors).toHaveLength(1);
      expect(errors[0]!.file).toBe("src/main.ts");
      expect(errors[0]!.error).toBe("TypeError: x is undefined");
      expect(errors[0]!.timestamp).toBeGreaterThan(0);
    });

    it("caps at 5 errors, evicting oldest", () => {
      for (let i = 0; i < 7; i++) {
        wm.addRecentError(`file${i}.ts`, `error ${i}`);
      }
      const errors = wm.getState().recentErrors;
      expect(errors).toHaveLength(5);
      expect(errors[0]!.error).toBe("error 2");
      expect(errors[4]!.error).toBe("error 6");
    });
  });

  describe("addDecision()", () => {
    it("adds a decision with rationale and timestamp", () => {
      wm.addDecision("Use SQLite", "Need local-only storage");
      const decisions = wm.getState().architecturalDecisions;
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.decision).toBe("Use SQLite");
      expect(decisions[0]!.rationale).toBe("Need local-only storage");
    });

    it("caps at 5 decisions", () => {
      for (let i = 0; i < 7; i++) {
        wm.addDecision(`decision ${i}`, `rationale ${i}`);
      }
      expect(wm.getState().architecturalDecisions).toHaveLength(5);
    });
  });

  describe("setActiveGoals()", () => {
    it("sets the goals list", () => {
      wm.setActiveGoals(["Build auth", "Write tests"]);
      expect(wm.getState().activeGoals).toEqual(["Build auth", "Write tests"]);
    });

    it("replaces previous goals", () => {
      wm.setActiveGoals(["Old goal"]);
      wm.setActiveGoals(["New goal"]);
      expect(wm.getState().activeGoals).toEqual(["New goal"]);
    });
  });

  describe("scratchpad", () => {
    it("stores and retrieves values", () => {
      wm.setScratchpad("counter", 42);
      expect(wm.getScratchpad("counter")).toBe(42);
    });

    it("returns undefined for missing keys", () => {
      expect(wm.getScratchpad("missing")).toBeUndefined();
    });
  });

  describe("serialize()", () => {
    it("returns empty string when state is empty", () => {
      expect(wm.serialize(1000)).toBe("");
    });

    it("produces valid markdown with task and files", () => {
      wm.setCurrentTask("Fix bug #123");
      wm.addOpenFile("src/app.ts");
      const output = wm.serialize(1000);
      expect(output).toContain("## Working Memory");
      expect(output).toContain("**Task**: Fix bug #123");
      expect(output).toContain("**Open files**: src/app.ts");
    });

    it("truncates within token budget by dropping low-priority sections first", () => {
      wm.setCurrentTask("Important task");
      wm.addOpenFile("src/a.ts");
      wm.addDecision("Use X", "Because Y");
      wm.addRecentError("src/b.ts", "Error occurred");
      wm.setActiveGoals(["Goal 1", "Goal 2"]);
      wm.setScratchpad("key", "value");

      // Very small budget: should include only the highest-priority parts.
      const output = wm.serialize(30); // ~120 chars
      expect(output).toContain("## Working Memory");
      expect(output).toContain("**Task**: Important task");
      // Scratchpad (lowest priority) should be dropped.
      expect(output).not.toContain("**Scratchpad**");
    });
  });

  describe("clear()", () => {
    it("resets all state to empty", () => {
      wm.setCurrentTask("Some task");
      wm.addOpenFile("src/file.ts");
      wm.addRecentError("src/file.ts", "Error");
      wm.addDecision("Decision", "Rationale");
      wm.setActiveGoals(["Goal"]);
      wm.setScratchpad("key", "val");

      wm.clear();

      const state = wm.getState();
      expect(state.currentTask).toBeNull();
      expect(state.openFiles).toEqual([]);
      expect(state.recentErrors).toEqual([]);
      expect(state.architecturalDecisions).toEqual([]);
      expect(state.activeGoals).toEqual([]);
      expect(state.scratchpad).toEqual({});
    });
  });

  describe("toJSON()", () => {
    it("returns valid JSON of the state", () => {
      wm.setCurrentTask("Test task");
      const json = wm.toJSON();
      const parsed = JSON.parse(json);
      expect(parsed.currentTask).toBe("Test task");
    });
  });
});
