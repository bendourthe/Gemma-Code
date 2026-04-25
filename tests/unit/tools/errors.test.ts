/**
 * Phase 2 property-based error suite (agent-friendly tools).
 *
 * Asserts that every documented error path of every handler in
 * src/tools/handlers and src/tools/{OutputRedirector,ToolRegistry}.ts
 * returns a failure ToolResult whose `error` string contains:
 *   1. The failing parameter name (or a relevant identifier from the schema), and
 *   2. The substring "Usage:" (case-insensitive).
 *
 * The meta-test at the bottom walks the source tree via the TypeScript
 * compiler API and asserts every literal `error: '...'` string in the listed
 * source files contains "Usage:". This catches future contributors who add a
 * new error path without following the convention.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

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
import { TailOutputTool, GrepOutputTool, OutputRedirector } from "../../../src/tools/OutputRedirector.js";
import type { ToolResult } from "../../../src/tools/types.js";
import { mockFs } from "../../setup.js";

function expectActionableError(result: ToolResult, paramName: string): void {
  expect(result.success).toBe(false);
  expect(typeof result.error).toBe("string");
  expect(result.error!.length).toBeGreaterThan(0);
  expect(result.error).toContain(paramName);
  expect(result.error!.toLowerCase()).toContain("usage:");
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Per-handler programmatic error scenarios
// ---------------------------------------------------------------------------

describe("error messages contain parameter name + Usage: hint", () => {
  it("read_file: missing path", async () => {
    const tool = new ReadFileTool();
    expectActionableError(await tool.execute({ _callId: "id" }), "path");
  });

  it("read_file: invalid range_start", async () => {
    const tool = new ReadFileTool();
    expectActionableError(
      await tool.execute({ _callId: "id", path: "f.ts", range_start: -1, range_end: 10 }),
      "range_start",
    );
  });

  it("read_file: range_end <= range_start", async () => {
    const tool = new ReadFileTool();
    expectActionableError(
      await tool.execute({ _callId: "id", path: "f.ts", range_start: 10, range_end: 5 }),
      "range_end",
    );
  });

  it("read_file: range window exceeds 1 MB", async () => {
    const tool = new ReadFileTool();
    expectActionableError(
      await tool.execute({
        _callId: "id",
        path: "f.ts",
        range_start: 0,
        range_end: 1024 * 1024 + 1,
      }),
      "range_end",
    );
  });

  it("read_file: file not found", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const tool = new ReadFileTool();
    expectActionableError(
      await tool.execute({ _callId: "id", path: "missing.ts" }),
      "path",
    );
  });

  it("write_file: missing path", async () => {
    const tool = new WriteFileTool();
    expectActionableError(await tool.execute({ _callId: "id" }), "path");
  });

  it("write_file: missing content", async () => {
    const tool = new WriteFileTool();
    expectActionableError(
      await tool.execute({ _callId: "id", path: "f.ts" }),
      "content",
    );
  });

  it("edit_file: missing path", async () => {
    const tool = new EditFileTool();
    expectActionableError(await tool.execute({ _callId: "id" }), "path");
  });

  it("edit_file: missing old_string", async () => {
    const tool = new EditFileTool();
    expectActionableError(
      await tool.execute({ _callId: "id", path: "f.ts", new_string: "x" }),
      "old_string",
    );
  });

  it("edit_file: missing new_string", async () => {
    const tool = new EditFileTool();
    expectActionableError(
      await tool.execute({ _callId: "id", path: "f.ts", old_string: "x" }),
      "new_string",
    );
  });

  it("edit_file: old_string not found", async () => {
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode("hello"));
    const tool = new EditFileTool();
    expectActionableError(
      await tool.execute({
        _callId: "id",
        path: "f.ts",
        old_string: "missing",
        new_string: "x",
      }),
      "old_string",
    );
  });

  it("create_file: missing path", async () => {
    const tool = new CreateFileTool();
    expectActionableError(await tool.execute({ _callId: "id" }), "path");
  });

  it("delete_file: missing path", async () => {
    const tool = new DeleteFileTool();
    expectActionableError(await tool.execute({ _callId: "id" }), "path");
  });

  it("grep_codebase: missing pattern", async () => {
    const tool = new GrepCodebaseTool();
    expectActionableError(await tool.execute({ _callId: "id" }), "pattern");
  });

  it("grep_codebase: ReDoS-risky pattern", async () => {
    const tool = new GrepCodebaseTool();
    expectActionableError(
      await tool.execute({ _callId: "id", pattern: "(a+)+b" }),
      "pattern",
    );
  });

  it("grep_codebase: invalid regex", async () => {
    const tool = new GrepCodebaseTool();
    expectActionableError(
      await tool.execute({ _callId: "id", pattern: "(unterminated" }),
      "pattern",
    );
  });

  it("grep_codebase: invalid max_results", async () => {
    const tool = new GrepCodebaseTool();
    expectActionableError(
      await tool.execute({ _callId: "id", pattern: "x", max_results: -1 }),
      "max_results",
    );
  });

  it("grep_codebase: invalid next_offset cursor", async () => {
    const tool = new GrepCodebaseTool();
    expectActionableError(
      await tool.execute({ _callId: "id", pattern: "x", next_offset: 42 }),
      "next_offset",
    );
  });

  it("run_terminal: missing command", async () => {
    const tool = new RunTerminalTool();
    expectActionableError(await tool.execute({ _callId: "id" }), "command");
  });

  it("run_terminal: blocked command", async () => {
    const tool = new RunTerminalTool();
    expectActionableError(
      await tool.execute({ _callId: "id", command: "rm -rf /" }),
      "command",
    );
  });

  it("tail_output: missing path", async () => {
    // Use a real OutputRedirector to construct the tool; the path-validation
    // path runs without touching the filesystem.
    const fsMod = require("fs") as typeof import("fs");
    const os = require("os") as typeof import("os");
    const tmp = fsMod.mkdtempSync(path.join(os.tmpdir(), "errors-test-"));
    const redirector = new OutputRedirector(tmp);
    const tool = new TailOutputTool(redirector);
    expectActionableError(await tool.execute({ _callId: "id" }), "path");
  });

  it("grep_output: missing path", async () => {
    const fsMod = require("fs") as typeof import("fs");
    const os = require("os") as typeof import("os");
    const tmp = fsMod.mkdtempSync(path.join(os.tmpdir(), "errors-test-"));
    const redirector = new OutputRedirector(tmp);
    const tool = new GrepOutputTool(redirector);
    expectActionableError(await tool.execute({ _callId: "id" }), "path");
  });

  it("grep_output: missing pattern", async () => {
    const fsMod = require("fs") as typeof import("fs");
    const os = require("os") as typeof import("os");
    const tmp = fsMod.mkdtempSync(path.join(os.tmpdir(), "errors-test-"));
    const redirector = new OutputRedirector(tmp);
    const tool = new GrepOutputTool(redirector);
    expectActionableError(
      await tool.execute({ _callId: "id", path: "/some/file" }),
      "pattern",
    );
  });
});

// ---------------------------------------------------------------------------
// AST meta-test: every error literal in tool source must contain "Usage:"
// ---------------------------------------------------------------------------

const SOURCES_TO_SCAN = [
  "src/tools/handlers/filesystem.ts",
  "src/tools/handlers/terminal.ts",
  "src/tools/handlers/webSearch.ts",
  "src/tools/OutputRedirector.ts",
  "src/tools/ToolRegistry.ts",
];

interface ErrorLiteralSite {
  file: string;
  line: number;
  text: string;
}

function isErrorPropertyAssignment(node: ts.PropertyAssignment): boolean {
  if (!ts.isIdentifier(node.name) && !ts.isStringLiteral(node.name)) return false;
  const name = ts.isIdentifier(node.name) ? node.name.text : node.name.text;
  return name === "error";
}

function collectErrorLiterals(file: string): ErrorLiteralSite[] {
  const fullPath = path.resolve(process.cwd(), file);
  const source = fs.readFileSync(fullPath, "utf-8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const sites: ErrorLiteralSite[] = [];

  function visit(node: ts.Node): void {
    // Pattern 1: object-literal `{ error: "..." }` — most ToolResult error sites.
    if (ts.isPropertyAssignment(node) && isErrorPropertyAssignment(node)) {
      const init = node.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        sites.push({ file, line: line + 1, text: init.text });
      } else if (ts.isTemplateExpression(init)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        // Build a flattened representation of the template head + spans for the assertion.
        let flat = init.head.text;
        for (const span of init.templateSpans) {
          flat += "${...}" + span.literal.text;
        }
        sites.push({ file, line: line + 1, text: flat });
      } else if (ts.isBinaryExpression(init)) {
        // Concatenation: walk the binary chain and collect string-literal pieces.
        const flat = flattenBinary(init);
        if (flat !== null) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          sites.push({ file, line: line + 1, text: flat });
        }
      }
    }

    // Pattern 2: `failResult(id, "...")` calls — used heavily in handlers.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "failResult" &&
      node.arguments.length >= 2
    ) {
      const arg = node.arguments[1]!;
      const flat = flattenStringExpression(arg);
      if (flat !== null) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        sites.push({ file, line: line + 1, text: flat });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return sites;
}

function flattenBinary(node: ts.BinaryExpression): string | null {
  const parts: string[] = [];
  let ok = true;
  const walk = (n: ts.Expression): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      walk(n.left);
      walk(n.right);
      return;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      parts.push(n.text);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      parts.push(n.head.text);
      for (const span of n.templateSpans) parts.push("${...}" + span.literal.text);
      return;
    }
    // Identifier / call expression — preserve as opaque but keep going.
    parts.push("${expr}");
  };
  try {
    walk(node);
  } catch {
    ok = false;
  }
  return ok ? parts.join("") : null;
}

function flattenStringExpression(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let flat = node.head.text;
    for (const span of node.templateSpans) flat += "${...}" + span.literal.text;
    return flat;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return flattenBinary(node);
  }
  return null;
}

// Strings that legitimately do not require "Usage:" because they are not
// agent-facing error returns: e.g., interface property defaults, internal
// flags. The list is intentionally short — adding to it requires explicit
// review.
const META_TEST_ALLOWLIST: ReadonlyArray<{ file: string; lineSubstr: string }> = [];

function isAllowlisted(site: ErrorLiteralSite): boolean {
  return META_TEST_ALLOWLIST.some(
    (a) => site.file === a.file && site.text.includes(a.lineSubstr),
  );
}

describe("AST meta-test: every tool error literal contains Usage:", () => {
  it("scans tool source files and asserts every error string carries 'Usage:'", () => {
    if (process.env["SKIP_ERROR_PROPERTY_TEST"] === "1") return;

    const violations: ErrorLiteralSite[] = [];
    for (const file of SOURCES_TO_SCAN) {
      for (const site of collectErrorLiterals(file)) {
        if (isAllowlisted(site)) continue;
        if (!/usage:/i.test(site.text)) {
          violations.push(site);
        }
      }
    }

    if (violations.length > 0) {
      const summary = violations
        .map((v) => `${v.file}:${v.line}\n  -> ${v.text.slice(0, 200)}`)
        .join("\n");
      throw new Error(
        `Found ${violations.length} tool error literal(s) without "Usage:" hint:\n${summary}\n` +
          `Each error returned from a tool handler must include the failing parameter name and a "Usage: ..." hint per Phase 2 of the v0.5.0 plan.`,
      );
    }
  });
});
