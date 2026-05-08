// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  compileTodoBlock,
  TODO_BLOCK_FN_SOURCE,
  type TodoEntryShape,
} from "../../../../../src/panels/webview/render/todoBlock.js";

const renderTodoBlock = compileTodoBlock(document);

const FIVE: TodoEntryShape[] = [
  { content: "Write spec", activeForm: "Writing spec", status: "pending" },
  { content: "Build module", activeForm: "Building module", status: "pending" },
  { content: "Add tests", activeForm: "Adding tests", status: "pending" },
  { content: "Run lint", activeForm: "Running lint", status: "pending" },
  { content: "Open PR", activeForm: "Opening PR", status: "pending" },
];

describe("renderTodoBlock", () => {
  it("renders the initial 5-todo list with all items in pending state", () => {
    const block = renderTodoBlock(FIVE);
    const items = block.querySelectorAll<HTMLLIElement>(".todo-item");
    expect(items).toHaveLength(5);
    items.forEach((li) => {
      expect(li.classList.contains("todo-status-pending")).toBe(true);
      expect(li.querySelector(".todo-glyph")?.textContent).toBe("□");
    });
  });

  it("uses the imperative content for completed todos with strikethrough class", () => {
    const todos = FIVE.slice();
    todos[1] = { ...todos[1]!, status: "completed" };
    const block = renderTodoBlock(todos);
    const second = block.querySelectorAll<HTMLLIElement>(".todo-item")[1];
    expect(second?.classList.contains("todo-status-completed")).toBe(true);
    expect(second?.querySelector(".todo-glyph")?.textContent).toBe("■");
    expect(second?.querySelector(".todo-text")?.textContent).toBe("Build module");
  });

  it("renders the activeForm text for in_progress todos and adds the glow class", () => {
    const todos = FIVE.slice();
    todos[2] = { ...todos[2]!, status: "in_progress" };
    const block = renderTodoBlock(todos);
    const third = block.querySelectorAll<HTMLLIElement>(".todo-item")[2];
    expect(third?.classList.contains("todo-status-in_progress")).toBe(true);
    expect(third?.classList.contains("todo-glow")).toBe(true);
    expect(third?.querySelector(".todo-glyph")?.textContent).toBe("★");
    expect(third?.querySelector(".todo-text")?.textContent).toBe("Adding tests");
  });

  it("includes a section heading announcing the block", () => {
    const block = renderTodoBlock(FIVE);
    expect(block.querySelector(".todo-block-heading")?.textContent).toBe("Update Todos");
  });

  it("never assigns user-supplied text to innerHTML", () => {
    expect(TODO_BLOCK_FN_SOURCE.includes("innerHTML")).toBe(false);
  });
});
