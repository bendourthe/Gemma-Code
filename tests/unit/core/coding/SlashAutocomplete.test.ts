import { describe, it, expect } from "vitest";
import {
  AUTOCOMPLETE_IPC_METHOD,
  autocompleteSlashCommands,
  type SlashSkillRecord,
  type SlashSuggestion,
} from "../../../../core/coding/SlashAutocomplete.js";

const BUILTINS: readonly SlashSuggestion[] = Object.freeze([
  { name: "plan", description: "Switch to Plan mode.", template: "/plan " },
  { name: "clear", description: "Clear chat.", template: "/clear" },
  { name: "remember", description: "Write a memory.", template: "/remember " },
]);

const SKILLS: readonly SlashSkillRecord[] = Object.freeze([
  { id: "user/code-quality", displayName: "code-quality", namespace: "user" },
  {
    id: "nexus-hub/code-quality",
    displayName: "code-quality",
    namespace: "nexus-hub",
    description: "Upstream code-quality skill.",
  },
  { id: "user/lint-fix", displayName: "lint-fix", namespace: "user" },
]);

describe("autocompleteSlashCommands", () => {
  it("returns all builtins on empty input", () => {
    const result = autocompleteSlashCommands(
      { input: "", preferUpstream: false },
      { builtins: BUILTINS, skills: [] },
    );
    expect(result.map((r) => r.name)).toEqual(["plan", "clear", "remember"]);
  });

  it("returns an empty list for input that does not start with '/'", () => {
    const result = autocompleteSlashCommands(
      { input: "plan", preferUpstream: false },
      { builtins: BUILTINS, skills: SKILLS },
    );
    expect(result).toEqual([]);
  });

  it("filters builtins by prefix", () => {
    const result = autocompleteSlashCommands(
      { input: "/cl", preferUpstream: false },
      { builtins: BUILTINS, skills: [] },
    );
    expect(result.map((r) => r.name)).toEqual(["clear"]);
  });

  it("appends skill suggestions after builtin matches", () => {
    const result = autocompleteSlashCommands(
      { input: "/", preferUpstream: false },
      { builtins: BUILTINS, skills: SKILLS },
    );
    const names = result.map((r) => r.name);
    expect(names.slice(0, BUILTINS.length)).toEqual([
      "plan",
      "clear",
      "remember",
    ]);
    // Skill names ordered with user variant first when preferUpstream=false.
    expect(names.slice(BUILTINS.length)).toContain("code-quality");
    expect(names.slice(BUILTINS.length)).toContain("lint-fix");
  });

  it("orders same-named user / nexus-hub skills by preferUpstream=false (user first)", () => {
    const result = autocompleteSlashCommands(
      { input: "/code", preferUpstream: false },
      { builtins: BUILTINS, skills: SKILLS },
    );
    const codeQualityHits = result.filter((r) => r.name === "code-quality");
    expect(codeQualityHits).toHaveLength(2);
    expect(codeQualityHits[0]?.namespace).toBe("user");
    expect(codeQualityHits[1]?.namespace).toBe("nexus-hub");
  });

  it("orders same-named user / nexus-hub skills by preferUpstream=true (nexus-hub first)", () => {
    const result = autocompleteSlashCommands(
      { input: "/code", preferUpstream: true },
      { builtins: BUILTINS, skills: SKILLS },
    );
    const hits = result.filter((r) => r.name === "code-quality");
    expect(hits[0]?.namespace).toBe("nexus-hub");
    expect(hits[1]?.namespace).toBe("user");
  });

  it("uses the skill description verbatim and falls back to a stock message", () => {
    const result = autocompleteSlashCommands(
      { input: "/code", preferUpstream: true },
      { builtins: BUILTINS, skills: SKILLS },
    );
    const upstream = result.find(
      (r) => r.name === "code-quality" && r.namespace === "nexus-hub",
    );
    const user = result.find(
      (r) => r.name === "code-quality" && r.namespace === "user",
    );
    expect(upstream?.description).toBe("Upstream code-quality skill.");
    expect(user?.description).toMatch(/skill from user/i);
  });

  it("constructs a template that pre-fills the composer", () => {
    const result = autocompleteSlashCommands(
      { input: "/lint", preferUpstream: false },
      { builtins: BUILTINS, skills: SKILLS },
    );
    const hit = result.find((r) => r.name === "lint-fix");
    expect(hit?.template).toBe("/lint-fix ");
    expect(hit?.skillId).toBe("user/lint-fix");
  });

  it("exposes the canonical IPC method id", () => {
    expect(AUTOCOMPLETE_IPC_METHOD).toBe("coding.chat.autocomplete");
  });
});
