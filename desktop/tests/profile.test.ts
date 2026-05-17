import { beforeEach, describe, expect, it } from "vitest";
import { readProfileSync, writeProfileSync } from "../src/lib/profile";

describe("profile", () => {
  beforeEach(() => window.localStorage.clear());

  it("falls back to User when nothing is stored", () => {
    expect(readProfileSync()).toEqual({ firstName: "User" });
  });

  it("round-trips a written profile", () => {
    writeProfileSync({ firstName: "Alex" });
    expect(readProfileSync()).toEqual({ firstName: "Alex" });
  });

  it("falls back to User on invalid stored JSON", () => {
    window.localStorage.setItem("nexus.profile", "{not-json");
    expect(readProfileSync()).toEqual({ firstName: "User" });
  });

  it("falls back to User on schema mismatch", () => {
    window.localStorage.setItem("nexus.profile", JSON.stringify({ firstName: "" }));
    expect(readProfileSync()).toEqual({ firstName: "User" });
  });
});
