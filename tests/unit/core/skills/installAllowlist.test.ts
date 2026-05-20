/**
 * v1.1.0 Phase 8.3 -- install-URL allowlist tests.
 */

import { describe, it, expect } from "vitest";
import {
  checkInstallUrl,
  INSTALL_ALLOWLIST,
} from "../../../../core/skills/installAllowlist.js";

describe("installAllowlist", () => {
  it("accepts every allowlisted host", () => {
    for (const host of INSTALL_ALLOWLIST) {
      const r = checkInstallUrl(`https://${host}/owner/repo/skill.md`);
      expect(r.ok, `host ${host} should be allowed`).toBe(true);
    }
  });

  it("rejects hosts not on the allowlist", () => {
    const r = checkInstallUrl("https://evil.example.com/skill.md");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not in the install allowlist/);
  });

  it("rejects file:// URLs by default", () => {
    const r = checkInstallUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/file:\/\/ URLs/);
  });

  it("accepts file:// URLs when allowFileUrls is set (test mode)", () => {
    const r = checkInstallUrl("file:///tmp/skill.md", { allowFileUrls: true });
    expect(r.ok).toBe(true);
  });

  it("rejects unparseable URLs", () => {
    const r = checkInstallUrl("not-a-url");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalid URL/);
  });

  it("rejects unsupported schemes", () => {
    const r = checkInstallUrl("ftp://github.com/owner/repo");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unsupported protocol/);
  });

  it("custom allowlist overrides the built-in", () => {
    const ok = checkInstallUrl("https://internal.corp/skill.md", {
      allowlist: ["internal.corp"],
    });
    expect(ok.ok).toBe(true);
    const blocked = checkInstallUrl("https://github.com/owner/repo", {
      allowlist: ["internal.corp"],
    });
    expect(blocked.ok).toBe(false);
  });

  it("hostname comparison is case-insensitive", () => {
    const r = checkInstallUrl("https://GITHUB.COM/owner/repo");
    expect(r.ok).toBe(true);
    expect(r.host).toBe("github.com");
  });
});
