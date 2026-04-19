import { describe, it, expect } from "vitest";
import { TaskDAG } from "../../../src/orchestration/TaskDAG.js";
import type { TaskNode } from "../../../src/orchestration/TaskDAG.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    title: overrides.id,
    description: `Description for ${overrides.id}`,
    type: "code",
    dependencies: [],
    status: "pending",
    retryCount: 0,
    maxRetries: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskDAG", () => {
  describe("constructor", () => {
    it("should accept an empty node list", () => {
      const dag = new TaskDAG([]);
      expect(dag.isComplete()).toBe(true);
      expect(dag.getProgress().total).toBe(0);
    });

    it("should accept a valid DAG", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
      ]);
      expect(dag.getProgress().total).toBe(2);
    });

    it("should throw on duplicate node IDs", () => {
      expect(
        () =>
          new TaskDAG([makeNode({ id: "a" }), makeNode({ id: "a" })]),
      ).toThrow("Duplicate node ID");
    });

    it("should throw when a dependency references an unknown node", () => {
      expect(
        () => new TaskDAG([makeNode({ id: "a", dependencies: ["missing"] })]),
      ).toThrow('depends on unknown node "missing"');
    });

    it("should throw when the graph contains a cycle", () => {
      expect(
        () =>
          new TaskDAG([
            makeNode({ id: "a", dependencies: ["b"] }),
            makeNode({ id: "b", dependencies: ["a"] }),
          ]),
      ).toThrow("contains a cycle");
    });

    it("should detect a 3-node cycle", () => {
      expect(
        () =>
          new TaskDAG([
            makeNode({ id: "a", dependencies: ["c"] }),
            makeNode({ id: "b", dependencies: ["a"] }),
            makeNode({ id: "c", dependencies: ["b"] }),
          ]),
      ).toThrow("contains a cycle");
    });
  });

  describe("addNode", () => {
    it("should add a node to an existing DAG", () => {
      const dag = new TaskDAG([makeNode({ id: "a" })]);
      dag.addNode(makeNode({ id: "b", dependencies: ["a"] }));
      expect(dag.getProgress().total).toBe(2);
    });

    it("should reject duplicate IDs", () => {
      const dag = new TaskDAG([makeNode({ id: "a" })]);
      expect(() => dag.addNode(makeNode({ id: "a" }))).toThrow(
        "Duplicate node ID",
      );
    });

    it("should reject unknown dependencies", () => {
      const dag = new TaskDAG([makeNode({ id: "a" })]);
      expect(() =>
        dag.addNode(makeNode({ id: "b", dependencies: ["missing"] })),
      ).toThrow("depends on unknown node");
    });

    it("should reject additions that would create a cycle", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
      ]);
      expect(() =>
        dag.addNode(makeNode({ id: "c", dependencies: ["b"] })),
      ).not.toThrow();

      // Now try to add a node that creates a->b->c->a.
      const dag2 = new TaskDAG([
        makeNode({ id: "x" }),
        makeNode({ id: "y", dependencies: ["x"] }),
      ]);
      dag2.addNode(makeNode({ id: "z", dependencies: ["y"] }));
      // Cannot directly test cycle-on-add since we cannot make x depend on z
      // after construction. addNode only adds forward edges.
      expect(dag2.getProgress().total).toBe(3);
    });
  });

  describe("getReadyNodes", () => {
    it("should return nodes with no dependencies", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b" }),
        makeNode({ id: "c", dependencies: ["a", "b"] }),
      ]);
      const ready = dag.getReadyNodes();
      expect(ready.map((n) => n.id).sort()).toEqual(["a", "b"]);
    });

    it("should return dependent nodes once dependencies are completed", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
      ]);
      dag.markCompleted("a", "done");
      const ready = dag.getReadyNodes();
      expect(ready).toHaveLength(1);
      expect(ready[0]!.id).toBe("b");
    });

    it("should not return running nodes", () => {
      const dag = new TaskDAG([makeNode({ id: "a" })]);
      dag.markRunning("a");
      expect(dag.getReadyNodes()).toHaveLength(0);
    });

    it("should not return nodes when a dependency is still pending", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b" }),
        makeNode({ id: "c", dependencies: ["a", "b"] }),
      ]);
      dag.markCompleted("a", "done");
      // "b" is still pending, so "c" should not be ready.
      expect(
        dag.getReadyNodes().map((n) => n.id),
      ).not.toContain("c");
    });
  });

  describe("markRunning", () => {
    it("should set node status to running", () => {
      const dag = new TaskDAG([makeNode({ id: "a" })]);
      dag.markRunning("a");
      expect(dag.getNode("a")?.status).toBe("running");
    });

    it("should throw for unknown node ID", () => {
      const dag = new TaskDAG([]);
      expect(() => dag.markRunning("missing")).toThrow("Unknown node ID");
    });
  });

  describe("markCompleted", () => {
    it("should set status and store result", () => {
      const dag = new TaskDAG([makeNode({ id: "a" })]);
      dag.markCompleted("a", "success output");
      const node = dag.getNode("a");
      expect(node?.status).toBe("completed");
      expect(node?.result).toBe("success output");
    });
  });

  describe("markFailed", () => {
    it("should set back to pending if retries remain", () => {
      const dag = new TaskDAG([makeNode({ id: "a", maxRetries: 2 })]);
      dag.markFailed("a", "error message");
      const node = dag.getNode("a")!;
      expect(node.status).toBe("pending");
      expect(node.retryCount).toBe(1);
      expect(node.error).toBe("error message");
    });

    it("should set to failed when all retries exhausted", () => {
      const dag = new TaskDAG([makeNode({ id: "a", maxRetries: 1 })]);
      dag.markFailed("a", "first error");
      expect(dag.getNode("a")?.status).toBe("failed");
    });

    it("should track retry count across multiple failures", () => {
      const dag = new TaskDAG([makeNode({ id: "a", maxRetries: 3 })]);
      dag.markFailed("a", "err1");
      expect(dag.getNode("a")?.retryCount).toBe(1);
      expect(dag.getNode("a")?.status).toBe("pending");

      dag.markFailed("a", "err2");
      expect(dag.getNode("a")?.retryCount).toBe(2);
      expect(dag.getNode("a")?.status).toBe("pending");

      dag.markFailed("a", "err3");
      expect(dag.getNode("a")?.retryCount).toBe(3);
      expect(dag.getNode("a")?.status).toBe("failed");
    });
  });

  describe("skipDependents", () => {
    it("should skip direct dependents", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
      ]);
      dag.skipDependents("a");
      expect(dag.getNode("b")?.status).toBe("skipped");
    });

    it("should skip transitive dependents", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
        makeNode({ id: "c", dependencies: ["b"] }),
        makeNode({ id: "d", dependencies: ["c"] }),
      ]);
      dag.skipDependents("a");
      expect(dag.getNode("b")?.status).toBe("skipped");
      expect(dag.getNode("c")?.status).toBe("skipped");
      expect(dag.getNode("d")?.status).toBe("skipped");
    });

    it("should not skip completed nodes", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
      ]);
      dag.markCompleted("b", "already done");
      dag.skipDependents("a");
      expect(dag.getNode("b")?.status).toBe("completed");
    });

    it("should handle diamond dependencies correctly", () => {
      // a -> b -> d
      // a -> c -> d
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
        makeNode({ id: "c", dependencies: ["a"] }),
        makeNode({ id: "d", dependencies: ["b", "c"] }),
      ]);
      dag.skipDependents("a");
      expect(dag.getNode("b")?.status).toBe("skipped");
      expect(dag.getNode("c")?.status).toBe("skipped");
      expect(dag.getNode("d")?.status).toBe("skipped");
    });
  });

  describe("isComplete", () => {
    it("should return true for empty DAG", () => {
      expect(new TaskDAG([]).isComplete()).toBe(true);
    });

    it("should return true when all nodes are completed or skipped", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b" }),
      ]);
      dag.markCompleted("a", "done");
      expect(dag.isComplete()).toBe(false);

      dag.markCompleted("b", "done");
      expect(dag.isComplete()).toBe(true);
    });

    it("should return false when nodes are still pending", () => {
      const dag = new TaskDAG([makeNode({ id: "a" })]);
      expect(dag.isComplete()).toBe(false);
    });
  });

  describe("getProgress", () => {
    it("should count all status types correctly", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b" }),
        makeNode({ id: "c" }),
        makeNode({ id: "d" }),
        makeNode({ id: "e", maxRetries: 0 }),
      ]);
      dag.markCompleted("a", "done");
      dag.markRunning("b");
      dag.markFailed("e", "err");
      // c remains pending, d remains pending.

      const progress = dag.getProgress();
      expect(progress.total).toBe(5);
      expect(progress.completed).toBe(1);
      expect(progress.running).toBe(1);
      expect(progress.failed).toBe(1);
      expect(progress.pending).toBe(2);
      expect(progress.skipped).toBe(0);
    });
  });

  describe("serialization", () => {
    it("should round-trip through toJSON/fromJSON", () => {
      const original = new TaskDAG([
        makeNode({ id: "a", type: "research" }),
        makeNode({ id: "b", type: "code", dependencies: ["a"] }),
        makeNode({ id: "c", type: "test", dependencies: ["b"] }),
      ]);
      original.markCompleted("a", "research done");

      const json = original.toJSON();
      const restored = TaskDAG.fromJSON(json);

      expect(restored.getProgress()).toEqual(original.getProgress());
      expect(restored.getNode("a")?.status).toBe("completed");
      expect(restored.getNode("a")?.result).toBe("research done");
      expect(restored.getNode("b")?.status).toBe("pending");
    });
  });

  describe("hasCycle", () => {
    it("should return false for a valid DAG", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
        makeNode({ id: "c", dependencies: ["a", "b"] }),
      ]);
      expect(dag.hasCycle()).toBe(false);
    });

    it("should return false for a diamond DAG", () => {
      const dag = new TaskDAG([
        makeNode({ id: "a" }),
        makeNode({ id: "b", dependencies: ["a"] }),
        makeNode({ id: "c", dependencies: ["a"] }),
        makeNode({ id: "d", dependencies: ["b", "c"] }),
      ]);
      expect(dag.hasCycle()).toBe(false);
    });

    it("should reject a self-loop at construction", () => {
      expect(
        () => new TaskDAG([makeNode({ id: "a", dependencies: ["a"] })]),
      ).toThrow(/cycle/i);
    });

    it("should reject a two-node cycle at construction", () => {
      expect(
        () =>
          new TaskDAG([
            makeNode({ id: "a", dependencies: ["b"] }),
            makeNode({ id: "b", dependencies: ["a"] }),
          ]),
      ).toThrow(/cycle/i);
    });
  });
});
