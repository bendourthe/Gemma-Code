import { describe, expect, it } from "vitest";
import {
  reportRegistryDrift,
  scanHandlerSource,
} from "../../../src/tools/AstToolScanner.js";

describe("AstToolScanner", () => {
  it("detects an exported handler class with an execute method", () => {
    const source = `
      export class FooTool {
        async execute() { return { id: "1", success: true, output: "" }; }
      }
    `;
    const result = scanHandlerSource("/path/foo.ts", source);
    expect(result.handlers).toHaveLength(1);
    expect(result.handlers[0]!.className).toBe("FooTool");
    expect(result.handlers[0]!.isExported).toBe(true);
    expect(result.handlers[0]!.hasExecuteMethod).toBe(true);
    expect(result.hasToolHandlerExports).toBe(true);
  });

  it("ignores files that have no handler class (NOT loaded)", () => {
    const source = `
      export function helper(x: number): number { return x + 1; }
      export const constants = { foo: 1 };
    `;
    const result = scanHandlerSource("/path/utils.ts", source);
    expect(result.handlers).toHaveLength(0);
    expect(result.hasToolHandlerExports).toBe(false);
  });

  it("ignores a class that lacks the execute method", () => {
    const source = `
      export class WidgetTool {
        constructor() {}
      }
    `;
    const result = scanHandlerSource("/path/widget.ts", source);
    expect(result.handlers).toHaveLength(1);
    expect(result.handlers[0]!.hasExecuteMethod).toBe(false);
    expect(result.hasToolHandlerExports).toBe(false);
  });

  it("records register() call sites with the first string-literal argument", () => {
    const source = `
      const registry = makeRegistry();
      registry.register("foo", new FooTool());
      registry.registerBuiltin("bar");
    `;
    const result = scanHandlerSource("/path/wire.ts", source);
    // Both calls are property accesses prefixed with `register*`; the scanner
    // records the first string-literal argument when present.
    expect(result.registerCalls).toContain("foo");
    expect(result.registerCalls).toContain("bar");
  });

  it("reportRegistryDrift flags skippable modules and unwired handlers", () => {
    const scans = [
      {
        filePath: "/a.ts",
        handlers: [{ className: "FooTool", isExported: true, hasExecuteMethod: true }],
        registerCalls: [],
        hasToolHandlerExports: true,
      },
      {
        filePath: "/helpers.ts",
        handlers: [],
        registerCalls: [],
        hasToolHandlerExports: false,
      },
    ];
    const drift = reportRegistryDrift(scans, ["WiredTool"]);
    expect(drift.skippableModules).toEqual(["/helpers.ts"]);
    expect(drift.unwiredHandlers).toEqual([
      { filePath: "/a.ts", className: "FooTool" },
    ]);
  });
});
