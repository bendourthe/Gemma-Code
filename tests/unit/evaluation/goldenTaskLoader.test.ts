import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  loadAllGoldenTasks,
  loadGoldenTask,
  parseGoldenTaskYaml,
  toGoldenTaskSpec,
} from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import {
  YAML_GOLDEN_TASK_COUNT,
  YAML_GOLDEN_TASK_IDS,
} from "../../../modules/coding/evaluation/goldenTasksYaml.generated.js";

/**
 * v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- unit tests for
 * the dependency-free golden-task YAML loader. The corpus tests guard the
 * parser against the real authored task set; the inline tests cover the tricky
 * constructs (escaped double-quoted scalars, block scalars, flow lists,
 * mapping sequences) and the fail-closed error paths.
 */

const TASKS_DIR = path.resolve(__dirname, "..", "..", "..", "tests", "golden", "tasks");
const KNOWN_TYPES = new Set([
  "file_contains",
  "file_exists",
  "file_deleted",
  "test_passes",
  "lint_passes",
  "diff_matches",
  "output_contains",
  "no_errors",
]);

describe("loadAllGoldenTasks - real corpus", () => {
  it("loads every task in the corpus and matches the generated id manifest", () => {
    const specs = loadAllGoldenTasks(TASKS_DIR);
    expect(specs.length).toBe(YAML_GOLDEN_TASK_COUNT);
    const ids = specs.map((s) => s.id).sort();
    expect(ids).toEqual([...YAML_GOLDEN_TASK_IDS].sort());
  });

  it("produces well-formed specs with valid criterion types and positive budgets", () => {
    const specs = loadAllGoldenTasks(TASKS_DIR);
    for (const spec of specs) {
      expect(spec.id.length).toBeGreaterThan(0);
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.initialState.length).toBeGreaterThan(0);
      expect(spec.successCriteria.length).toBeGreaterThan(0);
      expect(spec.maxIterations).toBeGreaterThan(0);
      expect(spec.timeoutSeconds).toBeGreaterThan(0);
      for (const c of spec.successCriteria) {
        expect(KNOWN_TYPES.has(c.type)).toBe(true);
        expect(typeof c.target).toBe("string");
      }
    }
  });

  it("decodes an escaped double-quoted regex pattern and a multiline block description", () => {
    const spec = loadGoldenTask(path.join(TASKS_DIR, "review-security-vuln-01.yaml"));
    // pattern: "\\?|\\$1|:id" -> \?|\$1|:id
    const placeholder = spec.successCriteria.find((c) => c.type === "file_contains");
    expect(placeholder?.pattern).toBe("\\?|\\$1|:id");
    // target: "grep -c \"'\\\" + \" src/db.ts || true" -> grep -c "'\" + " src/db.ts || true
    const grep = spec.successCriteria.find((c) => c.type === "output_contains");
    expect(grep?.target).toBe(`grep -c "'\\" + " src/db.ts || true`);
    expect(grep?.pattern).toBe("^0$");
    // The block scalar description preserves its interior newline(s).
    expect(spec.description).toContain("SQL injection");
    expect(spec.description.split("\n").length).toBeGreaterThan(1);
  });

  it("parses flow-list tags and a block sequence of expected files", () => {
    const spec = loadGoldenTask(path.join(TASKS_DIR, "multi-file-rename-01.yaml"));
    expect(spec.tags).toContain("typescript");
    expect(spec.tags).toContain("rename");
    expect(spec.expectedFilesChanged).toContain("src/utils.ts");
    expect(spec.expectedFilesChanged).toContain("src/index.ts");
  });
});

describe("parseGoldenTaskYaml - inline constructs", () => {
  it("parses single-quoted scalars, flow lists, and an empty flow list", () => {
    const root = parseGoldenTaskYaml(
      ["id: t1", "name: 'a single-quoted name'", "tags: [a, b, c]", "empty: []"].join("\n"),
    );
    expect(root["name"]).toBe("a single-quoted name");
    expect(root["tags"]).toEqual(["a", "b", "c"]);
    expect(root["empty"]).toEqual([]);
  });

  it("collects a mapping sequence with continuation lines", () => {
    const yaml = [
      "success_criteria:",
      "  - type: file_contains",
      "    target: src/x.ts",
      "    pattern: foo",
      "    description: has foo",
      "  - type: file_exists",
      "    target: src/y.ts",
    ].join("\n");
    const root = parseGoldenTaskYaml(yaml);
    const criteria = root["success_criteria"] as Array<Record<string, string>>;
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toMatchObject({ type: "file_contains", target: "src/x.ts", pattern: "foo" });
    expect(criteria[1]).toMatchObject({ type: "file_exists", target: "src/y.ts" });
  });

  it("ignores comment and blank lines", () => {
    const root = parseGoldenTaskYaml(["# a leading comment", "", "id: t2", "  # an indented comment", ""].join("\n"));
    expect(root["id"]).toBe("t2");
  });
});

describe("toGoldenTaskSpec + loader - validation (fail-closed)", () => {
  it("throws when a required field is missing", () => {
    expect(() => toGoldenTaskSpec({ name: "x", category: "c", description: "d", initial_state: "s" }, "f")).toThrow(
      /missing or empty required field 'id'/,
    );
  });

  it("throws on an unknown criterion type", () => {
    const root = parseGoldenTaskYaml(
      [
        "id: t",
        "name: n",
        "category: c",
        "description: d",
        "initial_state: s",
        "success_criteria:",
        "  - type: teleport",
        "    target: x",
      ].join("\n"),
    );
    expect(() => toGoldenTaskSpec(root, "f.yaml")).toThrow(/unknown type 'teleport'/);
  });

  it("rejects an unsupported folded block scalar", () => {
    expect(() => parseGoldenTaskYaml(["id: t", "description: >", "  folded text"].join("\n"))).toThrow(
      /folded block scalar/,
    );
  });

  it("rejects unexpected top-level indentation", () => {
    expect(() => parseGoldenTaskYaml(["id: t", "   stray: line"].join("\n"))).toThrow(
      /Unexpected indentation/,
    );
  });

  it("rejects a success_criteria value that is not a list of mappings", () => {
    const root = parseGoldenTaskYaml(
      [
        "id: t",
        "name: n",
        "category: c",
        "description: d",
        "initial_state: s",
        "success_criteria:",
        "  - just-a-scalar",
      ].join("\n"),
    );
    expect(() => toGoldenTaskSpec(root, "f.yaml")).toThrow(/must be a list of mappings/);
  });

  it("throws when the task directory does not exist", () => {
    expect(() => loadAllGoldenTasks(path.join(TASKS_DIR, "does-not-exist"))).toThrow(
      /task directory not found/i,
    );
  });
});
