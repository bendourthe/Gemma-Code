// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  ACTION_TAG_FN_SOURCE,
  compileActionTag,
  actionLabelFor,
  actionTargetFor,
} from "../../../../../src/panels/webview/render/actionTag.js";

const renderActionTag = compileActionTag(document);

describe("actionLabelFor", () => {
  it("maps every catalog tool to a Claude-Code-style label", () => {
    expect(actionLabelFor("read_file")).toBe("Read");
    expect(actionLabelFor("write_file")).toBe("Write");
    expect(actionLabelFor("edit_file")).toBe("Edit");
    expect(actionLabelFor("create_file")).toBe("Write");
    expect(actionLabelFor("delete_file")).toBe("Delete");
    expect(actionLabelFor("list_directory")).toBe("Ls");
    expect(actionLabelFor("grep_codebase")).toBe("Grep");
    expect(actionLabelFor("run_terminal")).toBe("Bash");
    expect(actionLabelFor("web_search")).toBe("Search");
    expect(actionLabelFor("fetch_page")).toBe("Fetch");
    expect(actionLabelFor("compress_range")).toBe("Compress");
    expect(actionLabelFor("update_todos")).toBe("Todos");
  });

  it("falls back to PascalCase for unknown tools", () => {
    expect(actionLabelFor("custom_tool_name")).toBe("CustomToolName");
  });
});

describe("actionTargetFor", () => {
  it("uses pattern for grep tools", () => {
    expect(actionTargetFor("grep_codebase", { pattern: "TODO" })).toBe("TODO");
  });

  it("uses command for run_terminal", () => {
    expect(actionTargetFor("run_terminal", { command: "ls -la" })).toBe("ls -la");
  });

  it("falls back to path", () => {
    expect(actionTargetFor("read_file", { path: "src/x.ts" })).toBe("src/x.ts");
  });
});

describe("renderActionTag", () => {
  it("renders Bash + path + size badge for a completed run_terminal", () => {
    const tag = renderActionTag(
      "run_terminal",
      { command: "npm test" },
      "completed",
      "5.16s",
    );
    expect(tag.classList.contains("action-tag")).toBe(true);
    expect(tag.classList.contains("action-status-completed")).toBe(true);
    expect(tag.querySelector(".action-label")?.textContent).toBe("Bash");
    expect(tag.querySelector(".action-target")?.textContent).toBe("npm test");
    expect(tag.querySelector(".action-badge")?.textContent).toBe("5.16s");
  });

  it("omits the badge element when no badge is provided", () => {
    const tag = renderActionTag("read_file", { path: "x.ts" }, "started");
    expect(tag.querySelector(".action-badge")).toBeNull();
  });

  it("encodes special characters via textContent (no HTML interpretation)", () => {
    const tag = renderActionTag(
      "run_terminal",
      { command: "<script>alert(1)</script>" },
      "completed",
    );
    const target = tag.querySelector(".action-target")?.textContent;
    expect(target).toBe("<script>alert(1)</script>");
  });

  it("applies the status class for started/completed/failed", () => {
    expect(
      renderActionTag("read_file", {}, "started").className,
    ).toContain("action-status-started");
    expect(
      renderActionTag("read_file", {}, "failed").className,
    ).toContain("action-status-failed");
  });

  it("never assigns user-supplied text to innerHTML", () => {
    expect(ACTION_TAG_FN_SOURCE.includes("innerHTML")).toBe(false);
  });
});
