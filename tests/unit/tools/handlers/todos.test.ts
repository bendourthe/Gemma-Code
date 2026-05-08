import { describe, it, expect, vi } from "vitest";
import { TodoState, UpdateTodosTool } from "../../../../src/tools/handlers/todos.js";

describe("UpdateTodosTool", () => {
  it("posts a renderTodoUpdate message and stores the latest list", async () => {
    const state = new TodoState();
    const post = vi.fn();
    const tool = new UpdateTodosTool(state, post);

    const result = await tool.execute({
      todos: [
        { content: "A", activeForm: "Aing", status: "pending" },
        { content: "B", activeForm: "Bing", status: "in_progress" },
      ],
    });

    expect(result.success).toBe(true);
    expect(post).toHaveBeenCalledWith({
      type: "renderTodoUpdate",
      todos: [
        { content: "A", activeForm: "Aing", status: "pending" },
        { content: "B", activeForm: "Bing", status: "in_progress" },
      ],
    });
    expect(state.getLatest()).toHaveLength(2);
  });

  it("rejects malformed input with an actionable error", async () => {
    const post = vi.fn();
    const tool = new UpdateTodosTool(new TodoState(), post);

    const missingArr = await tool.execute({});
    expect(missingArr.success).toBe(false);
    expect(missingArr.error).toMatch(/'todos' array/);

    const missingContent = await tool.execute({
      todos: [{ activeForm: "X", status: "pending" }],
    });
    expect(missingContent.success).toBe(false);
    expect(missingContent.error).toMatch(/content/);

    const badStatus = await tool.execute({
      todos: [{ content: "X", activeForm: "Xing", status: "weird" }],
    });
    expect(badStatus.success).toBe(false);
    expect(badStatus.error).toMatch(/pending/);
  });

  it("returns counts grouped by status", async () => {
    const tool = new UpdateTodosTool(new TodoState(), () => {});
    const result = await tool.execute({
      todos: [
        { content: "A", activeForm: "Aing", status: "pending" },
        { content: "B", activeForm: "Bing", status: "completed" },
        { content: "C", activeForm: "Cing", status: "completed" },
      ],
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload.counts).toEqual({ pending: 1, in_progress: 0, completed: 2 });
  });

  it("does not leak references to the caller's array", async () => {
    const state = new TodoState();
    const tool = new UpdateTodosTool(state, () => {});
    const inputArr = [
      { content: "A", activeForm: "Aing", status: "pending" as const },
    ];
    await tool.execute({ todos: inputArr });
    inputArr[0]!.content = "MUTATED";
    expect(state.getLatest()[0]?.content).toBe("A");
  });
});
