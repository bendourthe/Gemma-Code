import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createHeadlessTools,
  resolveInsideWorkdir,
  type HeadlessExec,
  type HeadlessTool,
} from "../../../modules/coding/runtime/headlessTools.js";

let workdir: string;

beforeEach(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "nexus-headless-tools-"));
});

afterEach(async () => {
  await fsp.rm(workdir, { recursive: true, force: true });
});

function tool(tools: HeadlessTool[], name: string): HeadlessTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool named ${name}`);
  return t;
}

describe("resolveInsideWorkdir", () => {
  it("resolves a relative path inside the root", () => {
    const abs = resolveInsideWorkdir(workdir, "sub/file.ts");
    expect(abs.startsWith(fs.realpathSync(workdir))).toBe(true);
  });

  it("throws on a parent-traversal escape", () => {
    expect(() => resolveInsideWorkdir(workdir, "../escape.ts")).toThrow(/outside/);
  });

  it("throws on an absolute path outside the root", () => {
    const outside = path.join(os.tmpdir(), "nexus-outside-xyz.ts");
    expect(() => resolveInsideWorkdir(workdir, outside)).toThrow(/outside/);
  });

  it("throws on an empty path", () => {
    expect(() => resolveInsideWorkdir(workdir, "")).toThrow(/required/);
  });
});

describe("createHeadlessTools -- file tools", () => {
  it("exposes the canonical tool vocabulary", () => {
    const names = createHeadlessTools().map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_file",
        "delete_file",
        "edit_file",
        "grep_codebase",
        "hash_file",
        "list_directory",
        "read_file",
        "run_terminal",
        "watch_path",
        "write_file",
      ].sort(),
    );
  });

  it("write_file then read_file round-trips through a nested dir", async () => {
    const tools = createHeadlessTools();
    const w = await tool(tools, "write_file").execute(
      { path: "src/a.ts", content: "hello" },
      { workdir },
    );
    expect(w.success).toBe(true);
    const r = await tool(tools, "read_file").execute({ path: "src/a.ts" }, { workdir });
    expect(r.success).toBe(true);
    expect(r.output).toBe("hello");
  });

  it("create_file fails when the file already exists", async () => {
    const tools = createHeadlessTools();
    await tool(tools, "create_file").execute({ path: "x.ts", content: "1" }, { workdir });
    const again = await tool(tools, "create_file").execute(
      { path: "x.ts", content: "2" },
      { workdir },
    );
    expect(again.success).toBe(false);
  });

  it("edit_file replaces the first occurrence and fails when old_text is absent", async () => {
    const tools = createHeadlessTools();
    await tool(tools, "write_file").execute({ path: "e.ts", content: "TODO here" }, { workdir });
    const edited = await tool(tools, "edit_file").execute(
      { path: "e.ts", old_text: "TODO", new_text: "DONE" },
      { workdir },
    );
    expect(edited.success).toBe(true);
    const r = await tool(tools, "read_file").execute({ path: "e.ts" }, { workdir });
    expect(r.output).toBe("DONE here");
    const miss = await tool(tools, "edit_file").execute(
      { path: "e.ts", old_text: "NOPE", new_text: "X" },
      { workdir },
    );
    expect(miss.success).toBe(false);
  });

  it("delete_file removes a file and errors on a missing one", async () => {
    const tools = createHeadlessTools();
    await tool(tools, "write_file").execute({ path: "d.ts", content: "1" }, { workdir });
    const del = await tool(tools, "delete_file").execute({ path: "d.ts" }, { workdir });
    expect(del.success).toBe(true);
    expect(fs.existsSync(path.join(workdir, "d.ts"))).toBe(false);
    const again = await tool(tools, "delete_file").execute({ path: "d.ts" }, { workdir });
    expect(again.success).toBe(false);
  });

  it("list_directory lists entries and defaults to the root", async () => {
    const tools = createHeadlessTools();
    await tool(tools, "write_file").execute({ path: "f.ts", content: "1" }, { workdir });
    await fsp.mkdir(path.join(workdir, "dir"));
    const listed = await tool(tools, "list_directory").execute({}, { workdir });
    expect(listed.success).toBe(true);
    expect(listed.output).toContain("- f.ts");
    expect(listed.output).toContain("d dir");
  });

  it("grep_codebase finds a literal match and skips node_modules", async () => {
    const tools = createHeadlessTools();
    await tool(tools, "write_file").execute(
      { path: "src/hit.ts", content: "const needle = 1;" },
      { workdir },
    );
    await fsp.mkdir(path.join(workdir, "node_modules", "pkg"), { recursive: true });
    await fsp.writeFile(path.join(workdir, "node_modules", "pkg", "z.ts"), "needle", "utf8");
    const res = await tool(tools, "grep_codebase").execute({ pattern: "needle" }, { workdir });
    expect(res.output).toContain("src/hit.ts:1");
    expect(res.output).not.toContain("node_modules");
  });

  it("refuses a traversal write (fail-closed)", async () => {
    const tools = createHeadlessTools();
    const res = await tool(tools, "write_file").execute(
      { path: "../escape.ts", content: "x" },
      { workdir },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/outside/);
  });
});

describe("createHeadlessTools -- run_terminal", () => {
  it("reports success on exit code 0 via the injected exec", async () => {
    const exec: HeadlessExec = async (command, cwd) => ({
      code: 0,
      stdout: `ran ${command} in ${path.basename(cwd)}`,
      stderr: "",
    });
    const tools = createHeadlessTools({ exec });
    const res = await tool(tools, "run_terminal").execute({ command: "echo hi" }, { workdir });
    expect(res.success).toBe(true);
    expect(res.output).toContain("stdout:");
    expect(res.output).toContain("exit code: 0");
  });

  it("reports failure on a non-zero exit code", async () => {
    const exec: HeadlessExec = async () => ({ code: 1, stdout: "", stderr: "boom" });
    const tools = createHeadlessTools({ exec });
    const res = await tool(tools, "run_terminal").execute({ command: "false" }, { workdir });
    expect(res.success).toBe(false);
    expect(res.output).toContain("stderr:");
  });

  it("caps oversized terminal output", async () => {
    const exec: HeadlessExec = async () => ({ code: 0, stdout: "A".repeat(5000), stderr: "" });
    const tools = createHeadlessTools({ exec, byteCap: 1000 });
    const res = await tool(tools, "run_terminal").execute({ command: "x" }, { workdir });
    expect(res.output).toContain("[truncated");
  });
});
