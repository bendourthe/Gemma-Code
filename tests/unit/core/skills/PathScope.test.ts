import { describe, it, expect } from "vitest";
import {
  InMemorySkillCatalog,
  matchPathScope,
  type Skill,
  type SkillPathScope,
} from "../../../../core/skills/SkillCatalog.js";

const HASH = "0".repeat(64);

function skill(id: string, pathScope?: SkillPathScope): Skill {
  const base: Skill = {
    id,
    displayName: id,
    category: "test",
    path: `/skills/${id}/SKILL.md`,
    frontmatter: { name: id },
    body: "# " + id + "\n",
    provenance: { source: "builtin", contentHash: HASH },
  };
  if (pathScope) {
    return { ...base, pathScope };
  }
  return base;
}

describe("matchPathScope", () => {
  it("undefined scope matches every candidate (including null)", () => {
    expect(matchPathScope(undefined, null)).toBe(true);
    expect(matchPathScope(undefined, "modules/coding/foo.ts")).toBe(true);
  });

  it("empty scope (no include, no exclude) matches every candidate", () => {
    expect(matchPathScope({}, "modules/coding/foo.ts")).toBe(true);
  });

  it("include with **/ matches files under the prefix", () => {
    const scope: SkillPathScope = { include: ["modules/coding/**"] };
    expect(matchPathScope(scope, "modules/coding/foo.ts")).toBe(true);
    expect(matchPathScope(scope, "modules/coding/sub/dir/foo.ts")).toBe(true);
    expect(matchPathScope(scope, "modules/chat/foo.ts")).toBe(false);
  });

  it("include with trailing slash auto-rewrites to **/", () => {
    const scope: SkillPathScope = { include: ["modules/coding/"] };
    expect(matchPathScope(scope, "modules/coding/foo.ts")).toBe(true);
    expect(matchPathScope(scope, "modules/coding/sub/bar.ts")).toBe(true);
    expect(matchPathScope(scope, "modules/chat/foo.ts")).toBe(false);
  });

  it("exclude trumps include when both match", () => {
    const scope: SkillPathScope = {
      include: ["modules/coding/**"],
      exclude: ["modules/coding/legacy/**"],
    };
    expect(matchPathScope(scope, "modules/coding/foo.ts")).toBe(true);
    expect(matchPathScope(scope, "modules/coding/legacy/old.ts")).toBe(false);
  });

  it("include with only exclude lets non-excluded paths through", () => {
    const scope: SkillPathScope = { exclude: ["**/node_modules/**"] };
    expect(matchPathScope(scope, "src/foo.ts")).toBe(true);
    expect(matchPathScope(scope, "src/node_modules/lib.ts")).toBe(false);
  });

  it("include null candidate falls back to empty string and does not match a scoped pattern", () => {
    const scope: SkillPathScope = { include: ["modules/coding/**"] };
    expect(matchPathScope(scope, null)).toBe(false);
  });

  it("normalises backslashes to forward slashes", () => {
    const scope: SkillPathScope = { include: ["modules/coding/**"] };
    expect(matchPathScope(scope, "modules\\coding\\foo.ts")).toBe(true);
  });

  it("**/foo.ts matches top-level and nested foo.ts files", () => {
    const scope: SkillPathScope = { include: ["**/foo.ts"] };
    expect(matchPathScope(scope, "foo.ts")).toBe(true);
    expect(matchPathScope(scope, "src/foo.ts")).toBe(true);
    expect(matchPathScope(scope, "src/sub/foo.ts")).toBe(true);
    expect(matchPathScope(scope, "src/foo.tsx")).toBe(false);
  });
});

describe("InMemorySkillCatalog.listForPath", () => {
  it("includes globally-scoped skills regardless of currentPath", () => {
    const catalog = new InMemorySkillCatalog([skill("global-skill")]);
    expect(catalog.listForPath("anywhere/foo.ts")).toHaveLength(1);
    expect(catalog.listForPath(null)).toHaveLength(1);
  });

  it("filters scoped skills by include glob", () => {
    const catalog = new InMemorySkillCatalog([
      skill("global-skill"),
      skill("coding-skill", { include: ["modules/coding/**"] }),
      skill("chat-skill", { include: ["modules/chat/**"] }),
    ]);
    const codingActive = catalog.listForPath("modules/coding/foo.ts");
    expect(codingActive.map((r) => r.id).sort()).toEqual(["coding-skill", "global-skill"]);

    const chatActive = catalog.listForPath("modules/chat/bar.ts");
    expect(chatActive.map((r) => r.id).sort()).toEqual(["chat-skill", "global-skill"]);

    const nowhereActive = catalog.listForPath("docs/foo.md");
    expect(nowhereActive.map((r) => r.id)).toEqual(["global-skill"]);
  });

  it("exposes pathScope on the returned record so the UI can render it", () => {
    const catalog = new InMemorySkillCatalog([
      skill("coding-skill", { include: ["modules/coding/**"] }),
    ]);
    const [record] = catalog.listForPath("modules/coding/foo.ts");
    expect(record?.pathScope?.include).toEqual(["modules/coding/**"]);
  });

  it("reevaluatePathScope returns the same view as listForPath", () => {
    const catalog = new InMemorySkillCatalog([
      skill("coding-skill", { include: ["modules/coding/**"] }),
    ]);
    expect(catalog.reevaluatePathScope("modules/coding/foo.ts")).toHaveLength(1);
    expect(catalog.reevaluatePathScope("docs/foo.md")).toHaveLength(0);
  });

  it("listForPath(null) excludes scoped skills (no include match)", () => {
    const catalog = new InMemorySkillCatalog([
      skill("global-skill"),
      skill("coding-skill", { include: ["modules/coding/**"] }),
    ]);
    expect(catalog.listForPath(null).map((r) => r.id)).toEqual(["global-skill"]);
  });
});
