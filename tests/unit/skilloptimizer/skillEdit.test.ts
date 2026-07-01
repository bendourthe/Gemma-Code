import { describe, it, expect } from "vitest";
import {
  applySkillEditOps,
  editChangedChars,
  hashSkillEdit,
  reassembleSkillFile,
  renderEditDiff,
  serializeSkillEdit,
  splitFrontmatter,
  withinLearningRate,
} from "../../../modules/coding/skilloptimizer/skillEdit.js";
import type { ProposedSkillEdit } from "../../../modules/coding/skilloptimizer/types.js";

/**
 * v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- unit tests for
 * the pure bounded-edit helpers: op application (add/delete/replace), changed-
 * char volume, the learning-rate budget predicate, deterministic hashing,
 * frontmatter split/reassembly, and the approval-diff rendering.
 */

function edit(ops: ProposedSkillEdit["ops"], rationale = "r"): ProposedSkillEdit {
  return { skillId: "s1", ops, rationale };
}

describe("applySkillEditOps", () => {
  it("appends on a bare add and inserts after a matched anchor", () => {
    expect(applySkillEditOps("body", [{ kind: "add", text: "more" }])).toBe("body\nmore");
    expect(applySkillEditOps("", [{ kind: "add", text: "first" }])).toBe("first");
    expect(applySkillEditOps("a b c", [{ kind: "add", match: "a", text: "X" }])).toBe("aX b c");
  });

  it("deletes and replaces the first occurrence of a match", () => {
    expect(applySkillEditOps("hello world", [{ kind: "delete", match: "hello " }])).toBe("world");
    expect(applySkillEditOps("v1 then v1", [{ kind: "replace", match: "v1", text: "v2" }])).toBe("v2 then v1");
  });

  it("is a no-op when a match is not found (never throws)", () => {
    expect(applySkillEditOps("body", [{ kind: "delete", match: "absent" }])).toBe("body");
    expect(applySkillEditOps("body", [{ kind: "replace", match: "absent", text: "x" }])).toBe("body");
    expect(applySkillEditOps("body", [{ kind: "add", match: "absent", text: "x" }])).toBe("body");
  });

  it("applies multiple ops in order", () => {
    const out = applySkillEditOps("one two three", [
      { kind: "replace", match: "one", text: "1" },
      { kind: "delete", match: " three" },
    ]);
    expect(out).toBe("1 two");
  });
});

describe("editChangedChars", () => {
  it("counts add by text, delete by match, replace by both", () => {
    expect(editChangedChars([{ kind: "add", text: "abcd" }])).toBe(4);
    expect(editChangedChars([{ kind: "delete", match: "xyz" }])).toBe(3);
    expect(editChangedChars([{ kind: "replace", match: "ab", text: "cde" }])).toBe(5);
  });
});

describe("withinLearningRate", () => {
  const budget = { maxOps: 2, maxChangedChars: 10 };
  it("accepts an edit inside both bounds", () => {
    expect(withinLearningRate(edit([{ kind: "add", text: "short" }]), budget)).toBe(true);
  });
  it("rejects zero ops, too many ops, and too many changed chars", () => {
    expect(withinLearningRate(edit([]), budget)).toBe(false);
    expect(
      withinLearningRate(
        edit([
          { kind: "add", text: "a" },
          { kind: "add", text: "b" },
          { kind: "add", text: "c" },
        ]),
        budget,
      ),
    ).toBe(false);
    expect(withinLearningRate(edit([{ kind: "add", text: "0123456789X" }]), budget)).toBe(false);
  });
});

describe("serializeSkillEdit / hashSkillEdit", () => {
  it("is deterministic and ignores the free-form rationale", () => {
    const a = edit([{ kind: "replace", match: "x", text: "y" }], "rationale one");
    const b = edit([{ kind: "replace", match: "x", text: "y" }], "rationale two");
    expect(serializeSkillEdit(a)).toBe(serializeSkillEdit(b));
    expect(hashSkillEdit(a)).toBe(hashSkillEdit(b));
  });
  it("differs when the ops differ", () => {
    const a = edit([{ kind: "replace", match: "x", text: "y" }]);
    const c = edit([{ kind: "replace", match: "x", text: "z" }]);
    expect(hashSkillEdit(a)).not.toBe(hashSkillEdit(c));
  });
});

describe("splitFrontmatter / reassembleSkillFile", () => {
  const file = "---\nname: s\nversion: 1.0.0\n---\nBody line one.\nBody line two.\n";

  it("splits header (with delimiters) from body", () => {
    const { header, body } = splitFrontmatter(file);
    expect(header).toBe("---\nname: s\nversion: 1.0.0\n---\n");
    expect(body).toBe("Body line one.\nBody line two.\n");
  });

  it("treats content with no frontmatter as all body", () => {
    const { header, body } = splitFrontmatter("just a body");
    expect(header).toBe("");
    expect(body).toBe("just a body");
  });

  it("treats a malformed/unterminated frontmatter marker as all body", () => {
    expect(splitFrontmatter("---")).toEqual({ header: "", body: "---" });
    expect(splitFrontmatter("---\nname: s\nno-close-delimiter")).toEqual({
      header: "",
      body: "---\nname: s\nno-close-delimiter",
    });
  });

  it("reassembles with a new body, preserving the frontmatter verbatim", () => {
    const reassembled = reassembleSkillFile(file, "New body.\n");
    expect(reassembled).toBe("---\nname: s\nversion: 1.0.0\n---\nNew body.\n");
  });
});

describe("renderEditDiff", () => {
  it("renders the skill id and one marker per op kind", () => {
    const diff = renderEditDiff(
      edit([
        { kind: "add", text: "added" },
        { kind: "delete", match: "gone" },
        { kind: "replace", match: "old", text: "new" },
      ]),
    );
    expect(diff).toContain("Skill: s1");
    expect(diff).toContain("+ added");
    expect(diff).toContain("- gone");
    expect(diff).toContain("- old");
    expect(diff).toContain("+ new");
  });
});
