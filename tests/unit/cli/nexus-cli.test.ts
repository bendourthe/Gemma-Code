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
});
