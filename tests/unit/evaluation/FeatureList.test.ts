import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadFeatureList,
  saveFeatureList,
  markPassing,
  validate,
  defaultFeatureListPath,
  type FeatureList,
} from "../../../modules/coding/evaluation/FeatureList.js";
import {
  stampGoldenTaskPass,
  getGoldenTaskFeatureId,
} from "../../../modules/coding/evaluation/GoldenTaskSuite.js";

function makeList(): FeatureList {
  return {
    version: "v0.8.0",
    features: [
      {
        id: "f001",
        name: "thing",
        description: "does thing",
        status: "not_started",
        evidence: "src/thing.ts",
        testedAt: null,
        verificationCommand: "npm run test",
      },
      {
        id: "f002",
        name: "other thing",
        description: "does other thing",
        status: "active",
        evidence: "src/other.ts",
        testedAt: null,
        verificationCommand: "npm run test:other",
      },
    ],
  };
}

describe("FeatureList", () => {
  let tmpDir: string;
  let listPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-fl-"));
    listPath = path.join(tmpDir, "feature_list.json");
    saveFeatureList(listPath, makeList());
  });

  it("round-trips through saveFeatureList + loadFeatureList", () => {
    const loaded = loadFeatureList(listPath);
    expect(loaded.version).toBe("v0.8.0");
    expect(loaded.features).toHaveLength(2);
    expect(loaded.features[0]!.id).toBe("f001");
  });

  it("validate() reports a clean list with no issues", () => {
    const issues = validate(loadFeatureList(listPath));
    expect(issues).toEqual([]);
  });

  it("validate() flags bad ids, missing fields, and invalid status", () => {
    const broken: FeatureList = {
      version: "0.8.0", // missing leading v
      features: [
        {
          id: "bad-id",
          name: "",
          description: "x",
          status: "weird" as never,
          evidence: "",
          testedAt: "not-a-date",
          verificationCommand: "",
        },
      ],
    };
    const issues = validate(broken);
    expect(issues.map((i) => i.field)).toEqual(
      expect.arrayContaining([
        "version",
        "id",
        "name",
        "status",
        "evidence",
        "verificationCommand",
        "testedAt",
      ]),
    );
  });

  it("markPassing flips status and stamps testedAt", () => {
    const list = loadFeatureList(listPath);
    const now = new Date("2026-05-15T12:00:00Z");
    const changed = markPassing(list, "f001", { now });
    expect(changed).toBe(true);
    expect(list.features[0]!.status).toBe("passing");
    expect(list.features[0]!.testedAt).toBe("2026-05-15");
  });

  it("markPassing returns false on unknown id", () => {
    const list = loadFeatureList(listPath);
    expect(markPassing(list, "f999")).toBe(false);
  });

  it("defaultFeatureListPath resolves under repo root", () => {
    expect(defaultFeatureListPath("/repo")).toMatch(/feature_list\.json$/);
  });

  it("stampGoldenTaskPass updates the right row and persists", () => {
    // gt-code-gen maps to f002 in the in-process suite
    const featureId = getGoldenTaskFeatureId("gt-code-gen");
    expect(featureId).toBe("f002");

    const now = new Date("2026-05-15T12:00:00Z");
    const changed = stampGoldenTaskPass("gt-code-gen", tmpDir, { listPath, now });
    expect(changed).toBe(true);

    const reloaded = loadFeatureList(listPath);
    const row = reloaded.features.find((f) => f.id === "f002");
    expect(row?.status).toBe("passing");
    expect(row?.testedAt).toBe("2026-05-15");
  });

  it("stampGoldenTaskPass is a no-op for unknown task ids", () => {
    expect(stampGoldenTaskPass("gt-not-a-task", tmpDir, { listPath })).toBe(false);
  });
});
