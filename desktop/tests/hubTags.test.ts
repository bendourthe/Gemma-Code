/**
 * v2.2.9 Phase 6.1 (T012) -- Hub tag normalization unit tests.
 * `3.21.0` and `v3.21.0` are the same release; a real difference stays unequal.
 */

import { describe, it, expect } from "vitest";

import { displayHubTag, hubTagsEqual, normalizeHubTag } from "../src/lib/hubTags";

describe("normalizeHubTag", () => {
  it("strips one leading v", () => {
    expect(normalizeHubTag("v3.21.0")).toBe("3.21.0");
    expect(normalizeHubTag("3.21.0")).toBe("3.21.0");
  });

  it("strips a leading uppercase V and lowercases the rest", () => {
    expect(normalizeHubTag("V3.21.0")).toBe("3.21.0");
    expect(normalizeHubTag("v3.21.0-RC1")).toBe("3.21.0-rc1");
  });

  it("trims whitespace and returns null for unknown/blank tags", () => {
    expect(normalizeHubTag(" v3.21.0 ")).toBe("3.21.0");
    expect(normalizeHubTag(null)).toBeNull();
    expect(normalizeHubTag(undefined)).toBeNull();
    expect(normalizeHubTag("   ")).toBeNull();
  });

  it("strips only one leading v (a version starting vv is not double-stripped)", () => {
    expect(normalizeHubTag("vv1.0.0")).toBe("v1.0.0");
  });
});

describe("hubTagsEqual", () => {
  it("treats 3.21.0 and v3.21.0 as the same release", () => {
    expect(hubTagsEqual("3.21.0", "v3.21.0")).toBe(true);
    expect(hubTagsEqual("v3.21.0", "3.21.0")).toBe(true);
    expect(hubTagsEqual("V3.21.0", "v3.21.0")).toBe(true);
  });

  it("keeps a real difference unequal", () => {
    expect(hubTagsEqual("v3.21.0", "v3.22.0")).toBe(false);
    expect(hubTagsEqual("3.21.0", "3.21.1")).toBe(false);
  });

  it("never equates unknown tags", () => {
    expect(hubTagsEqual(null, "v3.21.0")).toBe(false);
    expect(hubTagsEqual("v3.21.0", null)).toBe(false);
    expect(hubTagsEqual(null, null)).toBe(false);
    expect(hubTagsEqual("", "")).toBe(false);
  });
});

describe("displayHubTag", () => {
  it("renders the canonical form without a leading v", () => {
    expect(displayHubTag("v3.21.0")).toBe("3.21.0");
    expect(displayHubTag("3.21.0")).toBe("3.21.0");
    expect(displayHubTag("V3.21.0")).toBe("3.21.0");
  });

  it("passes unknown through as null", () => {
    expect(displayHubTag(null)).toBeNull();
    expect(displayHubTag(undefined)).toBeNull();
    expect(displayHubTag("  ")).toBeNull();
  });
});
