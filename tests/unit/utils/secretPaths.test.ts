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

  // ---------------------------------------------------------------------------
  // Edge cases pinned by Phase 7.4 (minimatch swap behavior parity)
  // ---------------------------------------------------------------------------

  it("only matches the empty path against an empty glob (degenerate case)", () => {
    // Both the hand-rolled regex compiler and minimatch anchor an empty
    // glob to the empty string, so an empty extra-pattern is effectively
    // inert against any real workspace path.
    expect(matchesSecretPath("any/file.txt", [""])).toBe(false);
    expect(matchesSecretPath("", [""])).toBe(true);
  });

  it("supports brace expansion in user-supplied extra patterns", () => {
    const extra = ["**/*.{tok,token}"];
    expect(matchesSecretPath("auth/api.tok", extra)).toBe(true);
    expect(matchesSecretPath("auth/api.token", extra)).toBe(true);
    expect(matchesSecretPath("auth/api.txt", extra)).toBe(false);
  });

  it("treats backslash inside a glob as an escape, not a path separator", () => {
    // Minimatch reads \\* as "literal asterisk". The path "literal*name" should
    // match; the path "expanded-name" (where * was expanded) must not.
    const extra = ["literal\\*name"];
    expect(matchesSecretPath("literal*name", extra)).toBe(true);
    expect(matchesSecretPath("literalXname", extra)).toBe(false);
  });

  it("handles exact-match patterns with no wildcards", () => {
    const extra = ["config/private.toml"];
    expect(matchesSecretPath("config/private.toml", extra)).toBe(true);
    expect(matchesSecretPath("config/private.toml.bak", extra)).toBe(false);
    expect(matchesSecretPath("nested/config/private.toml", extra)).toBe(false);
  });

  it("honors Windows-style path separators in the input even with mixed slashes", () => {
    // Slash normalization happens inside matchesSecretPath; minimatch then
    // sees a forward-slash path. Confirm both pure-Windows and mixed inputs.
    expect(matchesSecretPath("config\\.aws\\credentials")).toBe(true);
    expect(matchesSecretPath("config/.aws\\credentials")).toBe(true);
  });
});
