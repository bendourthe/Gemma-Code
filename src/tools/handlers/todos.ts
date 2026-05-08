import type { ToolHandler, ToolResult } from "../types.js";
import type { PostMessageFn } from "../../chat/StreamingPipeline.js";

/**
 * v0.7.0 Phase 4.4 -- The `update_todos` tool (C24).
 *
 * Permission tier 0 by design: emits a `renderTodoUpdate` webview message and
 * caches the most-recent list on a small holder. The handler does no file,
 * terminal, or network IO. The latest list is also surfaced through
 * {@link TodoState.getLatest} so the completion-report renderer (Phase 4.7)
 * can build its end-of-task summary without re-walking message history.
 */

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoEntry {
  readonly content: string;
  readonly activeForm: string;
  readonly status: TodoStatus;
}

/** In-memory holder for the latest todo publish; consumed by Phase 4.7. */
export class TodoState {
  private _latest: readonly TodoEntry[] = [];

  setLatest(todos: readonly TodoEntry[]): void {
    this._latest = todos.slice();
  }

  getLatest(): readonly TodoEntry[] {
    return this._latest;
  }

  clear(): void {
    this._latest = [];
  }
}

const VALID_STATUSES: ReadonlySet<TodoStatus> = new Set([
  "pending",
  "in_progress",
  "completed",
]);

function fail(id: string, error: string): ToolResult {
  return { id, success: false, output: "", error };
}

function ok(id: string, payload: Record<string, unknown>): ToolResult {
  return { id, success: true, output: JSON.stringify(payload) };
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function validateTodos(
  raw: unknown,
): { ok: true; value: TodoEntry[] } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "args must be an object with a 'todos' array" };
  }
  const r = raw as Record<string, unknown>;
  const todos = r["todos"];
  if (!Array.isArray(todos)) {
    return { ok: false, error: "missing 'todos' array (submit the FULL list each call)" };
  }
  const cleaned: TodoEntry[] = [];
  for (let i = 0; i < todos.length; i += 1) {
    const item = todos[i];
    if (item === null || typeof item !== "object") {
      return { ok: false, error: `todos[${i}] must be an object` };
    }
    const it = item as Record<string, unknown>;
    if (!isString(it["content"])) {
      return { ok: false, error: `todos[${i}].content must be a non-empty string` };
    }
    if (!isString(it["activeForm"])) {
      return { ok: false, error: `todos[${i}].activeForm must be a non-empty string` };
    }
    const status = it["status"];
    if (typeof status !== "string" || !VALID_STATUSES.has(status as TodoStatus)) {
      return {
        ok: false,
        error: `todos[${i}].status must be one of "pending" | "in_progress" | "completed"`,
      };
    }
    cleaned.push({
      content: it["content"] as string,
      activeForm: it["activeForm"] as string,
      status: status as TodoStatus,
    });
  }
  return { ok: true, value: cleaned };
}

export class UpdateTodosTool implements ToolHandler {
  constructor(
    private readonly _state: TodoState,
    private readonly _post: PostMessageFn,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const id = "update_todos";
    const validated = validateTodos(args);
    if (!validated.ok) return fail(id, `update_todos: ${validated.error}`);

    this._state.setLatest(validated.value);
    this._post({ type: "renderTodoUpdate", todos: validated.value.slice() });

    return ok(id, {
      accepted: validated.value.length,
      counts: {
        pending: validated.value.filter((t) => t.status === "pending").length,
        in_progress: validated.value.filter((t) => t.status === "in_progress").length,
        completed: validated.value.filter((t) => t.status === "completed").length,
      },
    });
  }
}
