import { describe, it, expect } from "vitest";
import { escapeLikePattern } from "../../../src/storage/likeEscape.js";

describe("escapeLikePattern", () => {
  it("escapes the LIKE wildcards", () => {
    expect(escapeLikePattern("100% cpu")).toBe("100\\% cpu");
    expect(escapeLikePattern("A_B")).toBe("A\\_B");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(escapeLikePattern("_%_")).toBe("\\_\\%\\_");
  });

  it("leaves non-wildcard characters untouched", () => {
    expect(escapeLikePattern("hello world")).toBe("hello world");
    expect(escapeLikePattern("")).toBe("");
    expect(escapeLikePattern("émoji 🌶")).toBe("émoji 🌶");
  });
});
