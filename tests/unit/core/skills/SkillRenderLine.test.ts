import { describe, it, expect } from "vitest";
import {
  renderSkillLine,
  renderSkillBlock,
} from "../../../../core/skills/SkillRenderLine.js";
import type { Skill } from "../../../../core/skills/SkillCatalog.js";

const HASH = "0".repeat(64);

function skill(over: Partial<Skill>): Skill {
  return {
    id: "writing-editing",
    displayName: "Writing and Editing",
    category: "developer-experience",
    path: "/skills/writing-editing/SKILL.md",
    frontmatter: { name: "writing-editing", description: "Write and edit docs." },
    body: "# Writing\n",
    provenance: { source: "builtin", contentHash: HASH },
    ...over,
  };
}

describe("renderSkillLine", () => {
  it("renders the canonical `- id: description (file: path)` shape", () => {
    expect(renderSkillLine(skill({}))).toBe(
      "- writing-editing: Write and edit docs. (file: /skills/writing-editing/SKILL.md)",
    );
  });

  it("flattens a description that contains a newline into a single space", () => {
    const line = renderSkillLine(
      skill({ frontmatter: { description: "First line.\nSecond line." } }),
    );
    expect(line).toBe(
      "- writing-editing: First line. Second line. (file: /skills/writing-editing/SKILL.md)",
    );
    expect(line).not.toContain("\n");
  });

  it("renders an empty description segment when frontmatter has no description", () => {
    expect(renderSkillLine(skill({ frontmatter: {} }))).toBe(
      "- writing-editing:  (file: /skills/writing-editing/SKILL.md)",
    );
  });

  it("never emits trailing whitespace", () => {
    const line = renderSkillLine(
      skill({ frontmatter: { description: "Trailing space.   " } }),
    );
    expect(line).toBe(
      "- writing-editing: Trailing space. (file: /skills/writing-editing/SKILL.md)",
    );
  });
});

describe("renderSkillBlock", () => {
  it("joins one canonical line per skill with newlines", () => {
    const block = renderSkillBlock([
      skill({ id: "a", path: "/a/SKILL.md", frontmatter: { description: "A." } }),
      skill({ id: "b", path: "/b/SKILL.md", frontmatter: { description: "B." } }),
    ]);
    expect(block).toBe(
      "- a: A. (file: /a/SKILL.md)\n- b: B. (file: /b/SKILL.md)",
    );
  });

  it("returns an empty string for an empty list", () => {
    expect(renderSkillBlock([])).toBe("");
  });
});
