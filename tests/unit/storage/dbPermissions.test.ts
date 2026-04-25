import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { secureDbPermissions } from "../../../src/storage/dbPermissions.js";
import { ToolOutputCache } from "../../../src/storage/ToolOutputCache.js";

/**
 * Phase 4 (v0.5.0) -- dbPermissions chmod tests.
 *
 * On POSIX, `secureDbPermissions` chmods the file to 0o600. On Windows the
 * chmod call is a no-op (ACL inheritance is the protective layer documented
 * in SECURITY.md), so the chmod-based assertions are skipped.
 */
describe("secureDbPermissions", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "dbperms-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  it.skipIf(process.platform === "win32")(
    "chmods an existing file to 0o600",
    () => {
      const target = path.join(tmpdir, "test.sqlite");
      fs.writeFileSync(target, "");
      fs.chmodSync(target, 0o644);

      secureDbPermissions(target);

      const mode = fs.statSync(target).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")(
    "covers the new tool-output-cache.sqlite via ToolOutputCache.open()",
    () => {
      const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ws-cache-"));
      const cache = new ToolOutputCache();
      cache.open(wsRoot);

      const dbPath = cache.dbPath();
      expect(dbPath).not.toBeNull();
      expect(fs.existsSync(dbPath!)).toBe(true);
      const mode = fs.statSync(dbPath!).mode & 0o777;
      expect(mode).toBe(0o600);

      cache.close();
      fs.rmSync(wsRoot, { recursive: true, force: true });
    },
  );

  it("is a no-op on a missing file (does not throw)", () => {
    const target = path.join(tmpdir, "does-not-exist.sqlite");
    expect(() => secureDbPermissions(target)).not.toThrow();
  });
});
