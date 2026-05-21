import { describe, it, expect } from "vitest";
import {
  filterMemoryRowsByHookKind,
  projectMemorySnapshotView,
  type MemorySnapshotInput,
} from "../../../../core/coding/MemorySnapshotView.js";

const BASE: MemorySnapshotInput = {
  layers: {
    core: ["c0"],
    recent: ["r0", "r1"],
    working: [],
    project: ["p0"],
  },
  anticipated: ["next-up"],
  proposedSkills: ["use-curator"],
};

describe("projectMemorySnapshotView", () => {
  it("flattens layers into rows in deterministic order (core, recent, working, project)", () => {
    const view = projectMemorySnapshotView(BASE);
    const ordered = view.rows.map((r) => `${r.layer}:${r.entry}`);
    expect(ordered).toEqual(["core:c0", "recent:r0", "recent:r1", "project:p0"]);
  });

  it("returns an empty anticipated / proposed lists when none are present", () => {
    const view = projectMemorySnapshotView({
      ...BASE,
      anticipated: [],
      proposedSkills: [],
    });
    expect(view.anticipated).toEqual([]);
    expect(view.proposedSkills).toEqual([]);
  });

  it("collects distinct hookKinds and toolNames into sorted lists", () => {
    const view = projectMemorySnapshotView({
      ...BASE,
      provenance: {
        core: [{ hookKind: "lifecycle.session.start", toolName: "boot" }],
        recent: [
          { hookKind: "lifecycle.tool.post", toolName: "read_file" },
          { hookKind: "lifecycle.tool.post", toolName: "write_file" },
        ],
        working: [],
        project: [{ hookKind: "lifecycle.session.start" }],
      },
    });
    expect(view.hookKinds).toEqual([
      "lifecycle.session.start",
      "lifecycle.tool.post",
    ]);
    expect(view.toolNames).toEqual(["boot", "read_file", "write_file"]);
  });

  it("attaches provenance to the correct row indices", () => {
    const view = projectMemorySnapshotView({
      ...BASE,
      provenance: {
        recent: [
          null,
          { hookKind: "lifecycle.tool.post", toolName: "read_file" },
        ],
        core: [],
        working: [],
        project: [],
      },
    });
    const recent = view.rows.filter((r) => r.layer === "recent");
    expect(recent[0]?.hookKind).toBeNull();
    expect(recent[1]?.hookKind).toBe("lifecycle.tool.post");
    expect(recent[1]?.toolName).toBe("read_file");
  });

  it("freezes the row list", () => {
    const view = projectMemorySnapshotView(BASE);
    expect(Object.isFrozen(view.rows)).toBe(true);
  });
});

describe("filterMemoryRowsByHookKind", () => {
  const view = projectMemorySnapshotView({
    ...BASE,
    provenance: {
      core: [{ hookKind: "lifecycle.session.start" }],
      recent: [{ hookKind: "lifecycle.tool.post" }, null],
      working: [],
      project: [{ hookKind: "lifecycle.session.start" }],
    },
  });

  it("returns all rows when filter is null", () => {
    expect(filterMemoryRowsByHookKind(view.rows, null)).toEqual(view.rows);
  });

  it("returns all rows when filter is '(all)'", () => {
    expect(filterMemoryRowsByHookKind(view.rows, "(all)")).toEqual(view.rows);
  });

  it("filters to the matching hookKind only", () => {
    const filtered = filterMemoryRowsByHookKind(
      view.rows,
      "lifecycle.session.start",
    );
    expect(filtered).toHaveLength(2);
    for (const r of filtered) {
      expect(r.hookKind).toBe("lifecycle.session.start");
    }
  });

  it("returns the empty array when no row matches", () => {
    expect(filterMemoryRowsByHookKind(view.rows, "no.such.hook")).toEqual([]);
  });
});
