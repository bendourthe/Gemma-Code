import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERSISTENCE_KEYS,
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
