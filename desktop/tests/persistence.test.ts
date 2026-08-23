import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERSISTENCE_KEYS,
  normalizeActiveRoute,
  readActiveRoute,
  writeActiveRoute,
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

  it.each(["/chatbot", "/coding", "/images", "/videos", "/settings"])(
    "restores the real module route %s unchanged",
    (route) => {
      expect(normalizeActiveRoute(route)).toBe(route);
    },
  );

  it("restores module sub-paths unchanged", () => {
    expect(normalizeActiveRoute("/settings/models")).toBe("/settings/models");
  });

  it("maps garbage to /chatbot instead of a blank route", () => {
    expect(normalizeActiveRoute("not-even-a-path")).toBe("/chatbot");
    expect(normalizeActiveRoute("/no-such-module")).toBe("/chatbot");
    expect(normalizeActiveRoute("/chatbotting")).toBe("/chatbot");
    expect(normalizeActiveRoute("")).toBe("/chatbot");
  });
});
