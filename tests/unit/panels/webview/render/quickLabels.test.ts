// @vitest-environment jsdom
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compileQuickLabels,
  DEFAULT_QUICK_LABELS,
  findQuickLabel,
  loadCustomQuickLabels,
  PLAN_QUICK_LABELS_TIPS,
} from "../../../../../src/panels/webview/render/quickLabels.js";

// Sanity-check the default chip catalog. The exact tips are user-visible
// strings; the assertions hold the canonical wording in place against
// accidental edits.
describe("DEFAULT_QUICK_LABELS", () => {
  it("ships the canonical 5-chip catalog", () => {
    expect(DEFAULT_QUICK_LABELS.map((l) => l.id)).toEqual([
      "out-of-scope",
      "add-test",
      "risky",
      "missing-rationale",
      "wrong-file",
    ]);
  });

  it("each chip carries a non-empty label and tip body", () => {
    for (const lbl of DEFAULT_QUICK_LABELS) {
      expect(lbl.label.length).toBeGreaterThan(0);
      expect(lbl.quickLabelTip.length).toBeGreaterThan(0);
    }
  });

  it("'Out of scope' carries the canonical task-boundary tip", () => {
    const chip = findQuickLabel("out-of-scope");
    expect(chip?.quickLabelTip).toContain("extends beyond the agreed task boundary");
  });
});

describe("findQuickLabel()", () => {
  it("returns the chip when id matches", () => {
    expect(findQuickLabel("risky")?.label).toBe("Risky");
  });

  it("returns null when id is not in the supplied catalog", () => {
    expect(findQuickLabel("nope")).toBeNull();
  });

  it("searches a custom catalog when provided", () => {
    const chip = findQuickLabel("foo", [
      { id: "foo", label: "F", quickLabelTip: "tip" },
    ]);
    expect(chip?.label).toBe("F");
  });
});

describe("loadCustomQuickLabels()", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ql-test-"));
    file = path.join(dir, "quick-labels.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] when the override file is missing", () => {
    expect(loadCustomQuickLabels(file)).toEqual([]);
  });

  it("returns [] and logs a warning when the file is unparseable JSON", () => {
    fs.writeFileSync(file, "{not json");
    expect(loadCustomQuickLabels(file)).toEqual([]);
  });

  it("parses an array of well-formed chips", () => {
    fs.writeFileSync(
      file,
      JSON.stringify([
        { id: "team-policy", label: "Team policy", quickLabelTip: "Cite team policy section." },
      ]),
    );
    const out = loadCustomQuickLabels(file);
    expect(out).toEqual([
      { id: "team-policy", label: "Team policy", quickLabelTip: "Cite team policy section." },
    ]);
  });

  it("filters out malformed rows without throwing", () => {
    fs.writeFileSync(
      file,
      JSON.stringify([
        { id: "ok", label: "OK", quickLabelTip: "tip" },
        { id: 1, label: "bad", quickLabelTip: "tip" }, // wrong type
        { label: "missing id", quickLabelTip: "tip" },
      ]),
    );
    expect(loadCustomQuickLabels(file)).toEqual([
      { id: "ok", label: "OK", quickLabelTip: "tip" },
    ]);
  });

  it("returns [] when the JSON root is not an array", () => {
    fs.writeFileSync(file, JSON.stringify({ id: "x", label: "y", quickLabelTip: "z" }));
    expect(loadCustomQuickLabels(file)).toEqual([]);
  });
});

describe("renderQuickLabels (render primitive)", () => {
  const renderQuickLabels = compileQuickLabels(document);

  it("renders one button per chip with the label as text content", () => {
    const row = renderQuickLabels(DEFAULT_QUICK_LABELS, { onPick: () => {} });
    const buttons = row.querySelectorAll<HTMLButtonElement>(".plan-quick-label");
    expect(buttons).toHaveLength(DEFAULT_QUICK_LABELS.length);
    expect(buttons[0]?.textContent).toBe("Out of scope");
  });

  it("each button carries the tip as `title` for hover preview", () => {
    const row = renderQuickLabels(DEFAULT_QUICK_LABELS, { onPick: () => {} });
    const btn = row.querySelector<HTMLButtonElement>(".plan-quick-label[data-label-id=risky]");
    expect(btn?.title).toContain("Flag the risk explicitly");
  });

  it("invokes onPick with the full chip object when clicked", () => {
    const onPick = vi.fn();
    const row = renderQuickLabels(DEFAULT_QUICK_LABELS, { onPick });
    const btn = row.querySelector<HTMLButtonElement>(
      ".plan-quick-label[data-label-id=add-test]",
    );
    btn?.click();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]?.id).toBe("add-test");
    expect(onPick.mock.calls[0]?.[0]?.quickLabelTip).toContain("test coverage");
  });

  it("accepts a merged catalog that includes user-supplied custom chips", () => {
    const custom = [
      ...DEFAULT_QUICK_LABELS,
      { id: "custom-1", label: "Custom", quickLabelTip: "..." },
    ];
    const row = renderQuickLabels(custom, { onPick: () => {} });
    expect(row.querySelectorAll(".plan-quick-label")).toHaveLength(custom.length);
  });
});

// Smoke test the existence of the `PLAN_QUICK_LABELS_TIPS` aggregate
// signature so external consumers (Memory.md docs, AGENTS.md) can verify
// at runtime that the canonical mapping has not silently regressed.
describe("PLAN_QUICK_LABELS_TIPS", () => {
  it("is keyed by chip id and exposes the canonical tip", () => {
    expect(PLAN_QUICK_LABELS_TIPS["out-of-scope"]).toContain(
      "extends beyond the agreed task boundary",
    );
  });
});
