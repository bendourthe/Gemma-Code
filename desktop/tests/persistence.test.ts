import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERSISTENCE_KEYS,
  normalizeActiveRoute,
  normalizeCodingWorkspaceSelection,
  readActiveRoute,
  readCodingWorkspacePath,
  readCodingWorkspaceSelection,
  writeActiveRoute,
  writeCodingWorkspacePath,
  writeCodingWorkspaceSelection,
} from "../src/lib/persistence";

describe("persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips the active route", () => {
    writeActiveRoute("/images");
    expect(readActiveRoute()).toBe("/images");
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.activeRoute)).toBe("/images");
  });

  it("round-trips the coding workspace path", () => {
    writeCodingWorkspacePath("C:\\work\\nexus-project");
    expect(readCodingWorkspacePath()).toBe("C:\\work\\nexus-project");
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.codingWorkspacePath)).toBe(
      "C:\\work\\nexus-project",
    );
  });

  it("migrates the legacy workspace path into a one-root selection", () => {
    writeCodingWorkspacePath("C:\\work\\legacy");
    expect(readCodingWorkspaceSelection()).toEqual({
      roots: ["C:\\work\\legacy"],
      primaryRoot: "C:\\work\\legacy",
    });
  });

  it("deduplicates Windows roots and orders the selected primary first", () => {
    expect(
      normalizeCodingWorkspaceSelection(
        ["C:\\work", "D:\\shared", "c:\\WORK"],
        "D:\\shared",
      ),
    ).toEqual({ roots: ["D:\\shared", "C:\\work"], primaryRoot: "D:\\shared" });
  });

  it("round-trips a multi-root workspace and keeps the legacy primary key current", () => {
    writeCodingWorkspaceSelection({
      roots: ["D:\\shared", "C:\\work"],
      primaryRoot: "C:\\work",
    });
    expect(readCodingWorkspaceSelection()).toEqual({
      roots: ["C:\\work", "D:\\shared"],
      primaryRoot: "C:\\work",
    });
    expect(readCodingWorkspacePath()).toBe("C:\\work");
  });

  it("falls back to the legacy path when structured workspace JSON is malformed", () => {
    writeCodingWorkspacePath("C:\\work\\fallback");
    window.localStorage.setItem(PERSISTENCE_KEYS.codingWorkspace, "{");
    expect(readCodingWorkspaceSelection()).toEqual({
      roots: ["C:\\work\\fallback"],
      primaryRoot: "C:\\work\\fallback",
    });
  });

  it("read returns null when nothing is stored", () => {
    expect(readActiveRoute()).toBeNull();
  });

  it("write swallows storage errors", () => {
    const setItem = vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => writeActiveRoute("/coding")).not.toThrow();
    setItem.mockRestore();
  });

  it("read swallows storage errors", () => {
    const getItem = vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(readActiveRoute()).toBeNull();
    getItem.mockRestore();
  });
});

// v2.2.3 Phase 1 (1.2, U7): restore matrix for the launch route.
describe("normalizeActiveRoute", () => {
  it("maps a missing stored route to /chatbot", () => {
    expect(normalizeActiveRoute(null)).toBe("/chatbot");
  });

  it('maps "/" to /chatbot', () => {
    expect(normalizeActiveRoute("/")).toBe("/chatbot");
  });

  it("maps /dashboard to /chatbot (dashboard is not the first-run landing)", () => {
    expect(normalizeActiveRoute("/dashboard")).toBe("/chatbot");
  });

  it.each(["/coding", "/images", "/videos", "/settings", "/dashboard"])(
    "maps last-module route %s to /chatbot on cold start (v2.2.4 Phase 1.1)",
    (route) => {
      expect(normalizeActiveRoute(route)).toBe("/chatbot");
    },
  );

  it("still restores /chatbot unchanged", () => {
    expect(normalizeActiveRoute("/chatbot")).toBe("/chatbot");
  });

  it("still restores a Chatbot thread sub-path", () => {
    expect(normalizeActiveRoute("/chatbot/thread-abc")).toBe("/chatbot/thread-abc");
  });

  it("does not restore settings sub-paths", () => {
    expect(normalizeActiveRoute("/settings/models")).toBe("/chatbot");
  });

  it("maps garbage to /chatbot instead of a blank route", () => {
    expect(normalizeActiveRoute("not-even-a-path")).toBe("/chatbot");
    expect(normalizeActiveRoute("/no-such-module")).toBe("/chatbot");
    expect(normalizeActiveRoute("/chatbotting")).toBe("/chatbot");
    expect(normalizeActiveRoute("")).toBe("/chatbot");
  });
});
