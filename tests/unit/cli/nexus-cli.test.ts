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
});
