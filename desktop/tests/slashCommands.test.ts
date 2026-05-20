import { describe, expect, it } from "vitest";
import {
  filterSlashCommands,
  filterSlashCommandsWithSkills,
  listSlashCommands,
  SLASH_COMMANDS,
  type SkillForAutocomplete,
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

describe("filterSlashCommandsWithSkills (Phase 8.4 preferUpstream)", () => {
  const skills: readonly SkillForAutocomplete[] = [
    {
      id: "user/code-quality",
      displayName: "code-quality",
      namespace: "user",
      description: "User-authored variant.",
    },
    {
      id: "devai-hub/code-quality",
      displayName: "code-quality",
      namespace: "devai-hub",
      description: "DevAI-Hub baseline.",
    },
    {
      id: "user/lonely",
      displayName: "lonely",
      namespace: "user",
    },
  ];

  it("places skills after the builtin catalog", () => {
    const out = filterSlashCommandsWithSkills("", skills);
    // The first N entries are the builtins.
    expect(out.slice(0, SLASH_COMMANDS.length)).toEqual(SLASH_COMMANDS);
    // Skill entries follow.
    expect(out.length).toBe(SLASH_COMMANDS.length + skills.length);
  });

  it("when preferUpstream is false, the user variant of a colliding name comes first", () => {
    const out = filterSlashCommandsWithSkills("/code", skills, {
      preferUpstream: false,
    });
    const codeQualityEntries = out.filter((c) => c.name === "code-quality");
    expect(codeQualityEntries).toHaveLength(2);
    expect(codeQualityEntries[0].namespace).toBe("user");
    expect(codeQualityEntries[1].namespace).toBe("devai-hub");
  });

  it("when preferUpstream is true, the devai-hub variant comes first", () => {
    const out = filterSlashCommandsWithSkills("/code", skills, {
      preferUpstream: true,
    });
    const codeQualityEntries = out.filter((c) => c.name === "code-quality");
    expect(codeQualityEntries[0].namespace).toBe("devai-hub");
    expect(codeQualityEntries[1].namespace).toBe("user");
  });

  it("skills with unique names appear regardless of the preferUpstream flag", () => {
    const off = filterSlashCommandsWithSkills("/lonely", skills, {
      preferUpstream: false,
    });
    const on = filterSlashCommandsWithSkills("/lonely", skills, {
      preferUpstream: true,
    });
    expect(off.some((c) => c.name === "lonely" && c.namespace === "user")).toBe(true);
    expect(on.some((c) => c.name === "lonely" && c.namespace === "user")).toBe(true);
  });

  it("returns the empty list for a non-slash prefix", () => {
    expect(filterSlashCommandsWithSkills("hello", skills)).toEqual([]);
  });

  it("skill entries carry their canonical skillId for the dispatcher", () => {
    const out = filterSlashCommandsWithSkills("/code", skills);
    const userEntry = out.find(
      (c) => c.name === "code-quality" && c.namespace === "user",
    );
    expect(userEntry?.skillId).toBe("user/code-quality");
  });
});
