import { describe, it, expect } from "vitest";
import { parseArgs } from "../../../bin/nexus.mjs";

describe("nexus CLI parseArgs", () => {
  it("captures command + subcommand", () => {
    const a = parseArgs(["skills", "sync"]);
    expect(a.command).toBe("skills");
    expect(a.subcommand).toBe("sync");
  });

  it("captures --tag with a value", () => {
    const a = parseArgs(["skills", "sync", "--tag", "v1.3.2"]);
    expect(a.flags.tag).toBe("v1.3.2");
  });

  it("captures --tag=v1.3.2 form", () => {
    const a = parseArgs(["skills", "sync", "--tag=v1.3.2"]);
    expect(a.flags.tag).toBe("v1.3.2");
  });

  it("treats bare --apply as true", () => {
    const a = parseArgs(["skills", "sync", "--apply"]);
    expect(a.flags.apply).toBe(true);
  });

  it("captures --help at top level", () => {
    const a = parseArgs(["--help"]);
    expect(a.help).toBe(true);
    expect(a.command).toBe(null);
  });

  // v1.1.0 Phase 6 -- memory subcommand parsing.
  it("captures memory audit + --since flag", () => {
    const a = parseArgs(["memory", "audit", "--since", "2026-05-01"]);
    expect(a.command).toBe("memory");
    expect(a.subcommand).toBe("audit");
    expect(a.flags.since).toBe("2026-05-01");
  });

  it("captures memory export + --out path", () => {
    const a = parseArgs(["memory", "export", "--out", "/tmp/dump.jsonl"]);
    expect(a.command).toBe("memory");
    expect(a.subcommand).toBe("export");
    expect(a.flags.out).toBe("/tmp/dump.jsonl");
  });

  it("captures memory decay --now as boolean", () => {
    const a = parseArgs(["memory", "decay", "--now"]);
    expect(a.command).toBe("memory");
    expect(a.subcommand).toBe("decay");
    expect(a.flags.now).toBe(true);
  });

  // v1.1.0 Phase 8.3 -- install/remove parsing.
  it("captures skills install <spec> --from <url>", () => {
    const a = parseArgs([
      "skills",
      "install",
      "user/code-quality",
      "--from",
      "https://github.com/owner/repo/SKILL.md",
    ]);
    expect(a.command).toBe("skills");
    expect(a.subcommand).toBe("install");
    expect(a.positional).toEqual(["user/code-quality"]);
    expect(a.flags.from).toBe("https://github.com/owner/repo/SKILL.md");
  });

  it("captures skills remove <spec>", () => {
    const a = parseArgs(["skills", "remove", "user/code-quality"]);
    expect(a.command).toBe("skills");
    expect(a.subcommand).toBe("remove");
    expect(a.positional).toEqual(["user/code-quality"]);
  });

  it("captures skills install with --overwrite flag", () => {
    const a = parseArgs([
      "skills",
      "install",
      "user/foo",
      "--from",
      "https://github.com/owner/repo",
      "--overwrite",
    ]);
    expect(a.flags.overwrite).toBe(true);
  });

  // v1.6.0 Phase 2 (AS004) -- trace export subcommand parsing.
  it("captures trace export with --trace, --out, and --db", () => {
    const a = parseArgs([
      "trace",
      "export",
      "--trace",
      "11111111-2222-3333-4444-555555555555",
      "--out",
      "guides/trace.html",
      "--db",
      "/tmp/traces.db",
    ]);
    expect(a.command).toBe("trace");
    expect(a.subcommand).toBe("export");
    expect(a.flags.trace).toBe("11111111-2222-3333-4444-555555555555");
    expect(a.flags.out).toBe("guides/trace.html");
    expect(a.flags.db).toBe("/tmp/traces.db");
  });
});
