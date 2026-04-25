/**
 * Phase 2 null-safety baseline (v0.5.0).
 *
 * Each tool handler is invoked with a sweep of pathological parameter shapes
 * (null, undefined, empty string, empty array, binary, NaN, very-long string)
 * and the test asserts the handler returns a `ToolResult` (does not throw)
 * — failure is fine, but no unhandled exception should escape.
 *
 * The point is to lock in handler robustness against malformed agent input
 * so future contributors cannot accidentally regress to throwing exceptions
 * that would crash the agent loop.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  CreateFileTool,
  DeleteFileTool,
  ListDirectoryTool,
  GrepCodebaseTool,
} from "../../../src/tools/handlers/filesystem.js";
import { RunTerminalTool } from "../../../src/tools/handlers/terminal.js";
import type { ToolHandler, ToolResult } from "../../../src/tools/types.js";

interface HandlerCase {
  readonly name: string;
  readonly factory: () => ToolHandler;
}

const HANDLERS: readonly HandlerCase[] = [
  { name: "read_file", factory: () => new ReadFileTool() },
  { name: "write_file", factory: () => new WriteFileTool() },
  { name: "edit_file", factory: () => new EditFileTool() },
  { name: "create_file", factory: () => new CreateFileTool() },
  { name: "delete_file", factory: () => new DeleteFileTool() },
  { name: "list_directory", factory: () => new ListDirectoryTool() },
  { name: "grep_codebase", factory: () => new GrepCodebaseTool() },
  { name: "run_terminal", factory: () => new RunTerminalTool() },
];

const PATHOLOGICAL_INPUTS: ReadonlyArray<{ name: string; params: Record<string, unknown> }> = [
  { name: "completely empty params", params: {} },
  { name: "null _callId", params: { _callId: null } },
  { name: "undefined _callId", params: { _callId: undefined } },
  { name: "all-null param values", params: { _callId: "id", path: null, command: null, pattern: null, content: null, old_string: null, new_string: null, query: null, url: null } },
  { name: "all-undefined param values", params: { _callId: "id", path: undefined, command: undefined, pattern: undefined } },
  { name: "empty-string params", params: { _callId: "id", path: "", command: "", pattern: "", content: "", old_string: "", new_string: "" } },
  { name: "wrong-type params (numbers)", params: { _callId: "id", path: 123, command: 456, pattern: 789, content: 0, old_string: 1, new_string: 2 } },
  { name: "wrong-type params (arrays)", params: { _callId: "id", path: [], command: [], pattern: [] } },
  { name: "wrong-type params (objects)", params: { _callId: "id", path: { foo: "bar" }, command: { x: 1 }, pattern: {} } },
  { name: "NaN numeric overrides", params: { _callId: "id", path: "x", pattern: "x", max_results: NaN, range_start: NaN } },
  { name: "very-long string params", params: { _callId: "id", path: "a".repeat(10_000), pattern: "a".repeat(10_000) } },
  // Note: binary content not exercised here because writeFile mock would receive bytes;
  // we focus on parameter null-safety.
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Tool handlers: null-safety baseline (no unhandled throws)", () => {
  for (const handler of HANDLERS) {
    for (const input of PATHOLOGICAL_INPUTS) {
      it(`${handler.name} survives pathological input: ${input.name}`, async () => {
        const tool = handler.factory();
        let result: ToolResult | undefined;
        let thrown: unknown = null;
        try {
          result = await tool.execute(input.params);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeNull();
        expect(result).toBeDefined();
        expect(typeof result!.success).toBe("boolean");
        expect(typeof result!.id).toBe("string");
        // Either output is a string (success or empty failure) or error is set.
        expect(typeof result!.output).toBe("string");
        if (!result!.success) {
          expect(typeof result!.error).toBe("string");
          expect(result!.error!.length).toBeGreaterThan(0);
        }
      });
    }
  }
});
