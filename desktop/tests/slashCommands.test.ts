import { describe, expect, it } from "vitest";
import {
  filterSlashCommands,
  listSlashCommands,
  SLASH_COMMANDS,
} from "../src/modules/coding/slashCommands";

describe("slash command catalog", () => {
  it("includes the documented commands (v1.1.0 Phase 6 adds /recall, /remember, /forget)", () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "plan",
        "clear",
        "commit",
        "review-pr",
        "curate",
        "trace",
        "thinking-mode",
        "skill-metrics",
        "memory",
        "recall",
        "remember",
        "forget",
        "verify",
        "research",
        "help",
      ]),
    );
  });

  it("listSlashCommands returns the catalog by reference", () => {
    expect(listSlashCommands()).toBe(SLASH_COMMANDS);
  });

  it("empty input returns the full list", () => {
    expect(filterSlashCommands("")).toEqual(SLASH_COMMANDS);
  });

  it("a bare slash returns the full list", () => {
    expect(filterSlashCommands("/")).toEqual(SLASH_COMMANDS);
  });

  it("a non-slash prefix returns nothing", () => {
    expect(filterSlashCommands("hello")).toEqual([]);
  });

  it("matches case-insensitively on the command name", () => {
    const matches = filterSlashCommands("/RE");
    expect(matches.map((c) => c.name)).toEqual(
      expect.arrayContaining(["review-pr", "research"]),
    );
  });

  it("returns empty when no command matches", () => {
    expect(filterSlashCommands("/zzz")).toEqual([]);
  });

  it("each entry exposes a template that is a non-empty slash command", () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.template.startsWith("/")).toBe(true);
      expect(c.description.length).toBeGreaterThan(5);
    }
  });
});
