import { describe, it, expect } from "vitest";
import { matchesSecretPath } from "../../../src/utils/secretPaths.js";

describe("matchesSecretPath", () => {
  it.each([
    [".env"],
    [".env.local"],
    ["config/.env.production"],
    ["id_rsa"],
    ["id_rsa.pub"],
    ["nested/dir/id_ed25519"],
    ["certs/server.pem"],
    ["keys/api.key"],
    ["credentials"],
    ["aws/credentials.json"],
    [".aws/config"],
    [".aws/nested/credentials"],
    [".ssh/known_hosts"],
    ["secrets/token"],
    [".gemma-code/mcp.json"],
  ])("matches known secret pattern: %s", (path) => {
    expect(matchesSecretPath(path)).toBe(true);
  });

  it.each([
    ["src/index.ts"],
    ["README.md"],
    ["package.json"],
    ["docs/architecture.md"],
    ["envs/readme.txt"],
    ["keyboard.ts"],
  ])("does NOT match safe path: %s", (path) => {
    expect(matchesSecretPath(path)).toBe(false);
  });

  it("handles Windows-style path separators", () => {
    expect(matchesSecretPath("config\\secrets\\token")).toBe(true);
    expect(matchesSecretPath("config\\normal\\file.ts")).toBe(false);
  });

  it("honors user-provided extra patterns", () => {
    const extra = ["**/*.mykey"];
    expect(matchesSecretPath("foo/bar.mykey", extra)).toBe(true);
    expect(matchesSecretPath("foo/bar.notmykey", extra)).toBe(false);
  });
});
