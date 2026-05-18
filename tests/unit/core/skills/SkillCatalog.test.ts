import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemorySkillCatalog,
  canonicalSkillId,
  namespaceForSource,
  type Skill,
} from "../../../../core/skills/SkillCatalog.js";

const BUILTIN_HASH = "0".repeat(64);
const USER_HASH = "1".repeat(64);
const DEVAI_HASH = "2".repeat(64);

const SAMPLE: readonly Skill[] = [
  {
    id: "writing-editing",
    displayName: "Writing and Editing",
    category: "developer-experience",
    path: "/skills/writing-editing/SKILL.md",
    frontmatter: { name: "writing-editing" },
    body: "# Writing\n",
    provenance: { source: "builtin", contentHash: BUILTIN_HASH },
  },
  {
    id: "devai-hub/skill-eval-loop",
    displayName: "Skill Eval Loop",
    category: "workflow",
    path: "/skills/devai-hub/skill-eval-loop/SKILL.md",
    frontmatter: { name: "skill-eval-loop" },
    body: "# Eval\n",
    provenance: { source: "devai-hub", tag: "v1.3.2", contentHash: DEVAI_HASH },
  },
];

describe("InMemorySkillCatalog", () => {
  let catalog: InMemorySkillCatalog;
  beforeEach(() => {
    catalog = new InMemorySkillCatalog(SAMPLE);
  });

  it("list() returns id/display/category records (no body)", () => {
    const records = catalog.list();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id)).toEqual([
      "writing-editing",
      "devai-hub/skill-eval-loop",
    ]);
    expect((records[0] as { body?: string }).body).toBeUndefined();
  });

  it("load() returns the full skill including frontmatter and body", async () => {
    const skill = await catalog.load("writing-editing");
    expect(skill.frontmatter).toEqual({ name: "writing-editing" });
    expect(skill.body).toBe("# Writing\n");
  });

  it("load() throws for an unknown id", async () => {
    await expect(catalog.load("nope")).rejects.toThrow(/unknown skill id nope/);
  });

  it("namespaced devai-hub/<name> ids are first-class", () => {
    const records = catalog.list();
    expect(records.some((r) => r.id.startsWith("devai-hub/"))).toBe(true);
  });

  it("reload() resolves and may be a no-op", async () => {
    await expect(catalog.reload()).resolves.toBeUndefined();
  });

  it("resetForTesting() swaps the entire catalogue", () => {
    catalog.resetForTesting([SAMPLE[0]!]);
    expect(catalog.list()).toHaveLength(1);
  });

  it("default constructor yields an empty catalogue", () => {
    const empty = new InMemorySkillCatalog();
    expect(empty.list()).toEqual([]);
  });

  it("list() carries the provenance field on every record", () => {
    const records = catalog.list();
    expect(records[0]!.provenance).toEqual({
      source: "builtin",
      contentHash: BUILTIN_HASH,
    });
    expect(records[1]!.provenance).toEqual({
      source: "devai-hub",
      tag: "v1.3.2",
      contentHash: DEVAI_HASH,
    });
  });

  it("listByNamespace() filters by provenance source", () => {
    const builtin = catalog.listByNamespace("builtin");
    expect(builtin).toHaveLength(1);
    expect(builtin[0]!.id).toBe("writing-editing");
    const devai = catalog.listByNamespace("devai-hub");
    expect(devai).toHaveLength(1);
    expect(devai[0]!.id).toBe("devai-hub/skill-eval-loop");
    expect(catalog.listByNamespace("user")).toEqual([]);
  });

  it("does not collide when a user skill shares a name with devai-hub", () => {
    catalog.resetForTesting([
      {
        ...SAMPLE[0]!,
      },
      {
        id: "user/code-quality",
        displayName: "Code Quality",
        category: "review",
        path: "/u/code-quality/SKILL.md",
        frontmatter: {},
        body: "user",
        provenance: { source: "user", contentHash: USER_HASH },
      },
      {
        id: "devai-hub/code-quality",
        displayName: "Code Quality",
        category: "review",
        path: "/d/code-quality/SKILL.md",
        frontmatter: {},
        body: "devai",
        provenance: { source: "devai-hub", tag: "v1.3.2", contentHash: DEVAI_HASH },
      },
    ]);
    const ids = catalog.list().map((r) => r.id);
    expect(ids).toContain("user/code-quality");
    expect(ids).toContain("devai-hub/code-quality");
    expect(new Set(ids).size).toBe(ids.length); // unique
  });

  it("flags diverged display names across sources", () => {
    catalog.resetForTesting([
      {
        id: "user/code-quality",
        displayName: "Code Quality",
        category: "review",
        path: "/u/code-quality/SKILL.md",
        frontmatter: {},
        body: "user",
        provenance: { source: "user", contentHash: USER_HASH },
      },
      {
        id: "devai-hub/code-quality",
        displayName: "Code Quality",
        category: "review",
        path: "/d/code-quality/SKILL.md",
        frontmatter: {},
        body: "devai",
        provenance: { source: "devai-hub", tag: "v1.3.2", contentHash: DEVAI_HASH },
      },
    ]);
    const records = catalog.list();
    expect(records.every((r) => r.diverged === true)).toBe(true);
  });

  it("does not flag diverged when only one source uses a display name", () => {
    const records = catalog.list();
    expect(records[0]!.diverged).toBeUndefined();
    expect(records[1]!.diverged).toBeUndefined();
  });
});

describe("canonicalSkillId / namespaceForSource", () => {
  it("returns the bare name for builtin sources", () => {
    expect(canonicalSkillId("builtin", "code-quality")).toBe("code-quality");
  });

  it("prefixes the namespace for user and devai-hub sources", () => {
    expect(canonicalSkillId("user", "my-skill")).toBe("user/my-skill");
    expect(canonicalSkillId("devai-hub", "code-quality")).toBe("devai-hub/code-quality");
  });

  it("namespaceForSource() echoes the source", () => {
    expect(namespaceForSource("builtin")).toBe("builtin");
    expect(namespaceForSource("user")).toBe("user");
    expect(namespaceForSource("devai-hub")).toBe("devai-hub");
  });
});
