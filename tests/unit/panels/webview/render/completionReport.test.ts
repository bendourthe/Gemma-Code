// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  buildCompletionReport,
  compileCompletionReport,
  COMPLETION_REPORT_FN_SOURCE,
  type CompletionReportItem,
} from "../../../../../src/panels/webview/render/completionReport.js";

const renderCompletionReport = compileCompletionReport(document);

describe("buildCompletionReport", () => {
  it("emits Plan / Sub-task / Updates / Tests / Commit fields when populated", () => {
    const items = buildCompletionReport({
      todos: [
        { content: "A", activeForm: "Aing", status: "completed" },
        { content: "B", activeForm: "Bing", status: "completed" },
        { content: "C", activeForm: "Cing", status: "pending" },
      ],
      editedFiles: ["src/foo.ts", "src/bar.ts"],
      testsRun: ["vitest run"],
      commit: { sha: "abcdef0123", message: "feat(x): add", href: "/commit/abcdef0" },
    });
    const fields = items.map((i) => i.field);
    expect(fields).toEqual([
      "Plan",
      "Sub-task done",
      "Updates landed",
      "Tests run",
      "Commit",
    ]);
    expect(items[0]?.value).toBe("2/3 todos complete");
    expect(items[1]?.value).toBe("B");
    expect(items[2]?.value).toBe("src/foo.ts, src/bar.ts");
    expect(items[3]?.value).toBe("vitest run");
    expect(items[4]?.value).toBe("abcdef0 feat(x): add");
    expect(items[4]?.href).toBe("/commit/abcdef0");
  });

  it("drops empty fields", () => {
    const items = buildCompletionReport({
      todos: [],
      editedFiles: [],
      testsRun: [],
    });
    expect(items).toHaveLength(0);
  });

  it("truncates the file list past three entries with a +N more suffix", () => {
    const items = buildCompletionReport({
      todos: [],
      editedFiles: ["a", "b", "c", "d", "e"],
      testsRun: [],
    });
    expect(items[0]?.value).toBe("a, b, c (+2 more)");
  });
});

describe("renderCompletionReport", () => {
  it("renders a four-field report as a table", () => {
    const items: CompletionReportItem[] = [
      { field: "Plan", value: "3/3 todos complete" },
      { field: "Updates landed", value: "src/x.ts" },
      { field: "Tests run", value: "vitest run" },
      { field: "Commit", value: "abc1234 feat: x", href: "/abc" },
    ];
    const card = renderCompletionReport(items);
    expect(card.classList.contains("completion-report")).toBe(true);
    expect(card.querySelectorAll(".completion-report-row")).toHaveLength(4);
  });

  it("renders the commit value as a clickable link", () => {
    const card = renderCompletionReport([
      { field: "Commit", value: "abcdefg short msg", href: "https://x.test/c/abc" },
    ]);
    const link = card.querySelector<HTMLAnchorElement>(".completion-report-link");
    expect(link?.textContent).toBe("abcdefg short msg");
    expect(link?.dataset.href).toBe("https://x.test/c/abc");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("returns an empty element with class completion-report-empty when nothing to show", () => {
    const empty = renderCompletionReport([]);
    expect(empty.classList.contains("completion-report-empty")).toBe(true);
    expect(empty.querySelector(".completion-report-table")).toBeNull();
  });

  it("never assigns user-supplied text to innerHTML", () => {
    expect(COMPLETION_REPORT_FN_SOURCE.includes("innerHTML")).toBe(false);
  });
});
