import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERSISTENCE_KEYS,
  normalizeActiveRoute,
  readActiveRoute,
  readCodingWorkspacePath,
  writeActiveRoute,
  writeCodingWorkspacePath,
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
