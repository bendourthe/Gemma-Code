import { describe, expect, it } from "vitest";

import {
  probeMacosSeatbelt,
  renderSeatbeltProfile,
} from "../../../modules/coding/sandbox/backends/macosSeatbelt.js";
import { deriveDefaultPolicy } from "../../../modules/coding/sandbox/policy.js";

describe("renderSeatbeltProfile", () => {
  it("limits writes to writable roots and denies network by default", () => {
    const policy = deriveDefaultPolicy("/tmp/ws", {
      tmpDir: "/tmp",
      homeDir: "/Users/dev",
      extraDenyReadRoots: ["/Users/dev/.ssh"],
    });
    const profile = renderSeatbeltProfile({
      ...policy,
      writableRoots: ["/tmp/ws", "/tmp"],
      denyReadRoots: ["/Users/dev/.ssh"],
    });
    expect(profile).toContain("(version 1)");
    expect(profile).toContain("(deny default)");
    expect(profile).toContain('(subpath "/tmp/ws")');
    expect(profile).toContain('(subpath "/tmp")');
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(deny file-read* (subpath "/Users/dev/.ssh"))');
  });

  it("allows network when the policy says so", () => {
    const policy = deriveDefaultPolicy("/tmp/ws", { network: "allow", tmpDir: "/tmp" });
    const profile = renderSeatbeltProfile({ ...policy, writableRoots: ["/tmp/ws"] });
    expect(profile).toContain("(allow network*)");
    expect(profile).not.toContain("(deny network*)");
  });
});

describe("probeMacosSeatbelt", () => {
  it("is unavailable on non-darwin platforms", () => {
    const cap = probeMacosSeatbelt("win32");
    expect(cap.available).toBe(false);
    expect(cap.backendId).toBe("macos-seatbelt");
  });
});
