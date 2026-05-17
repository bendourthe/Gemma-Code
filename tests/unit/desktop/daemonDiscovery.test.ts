import { describe, it, expect } from "vitest";
import {
  defaultDaemonPath,
  discoverDesktopDaemon,
} from "../../../src/desktop/daemonDiscovery.js";

describe("defaultDaemonPath", () => {
  it("returns a named pipe on Windows", () => {
    const original = process.env.USERNAME;
    process.env.USERNAME = "alice";
    try {
      const p = defaultDaemonPath("win32", "C:/Users/alice");
      expect(p).toBe("\\\\.\\pipe\\nexus.alice.sock");
    } finally {
      if (original === undefined) delete process.env.USERNAME;
      else process.env.USERNAME = original;
    }
  });

  it("falls back to 'default' when USERNAME is unset on Windows", () => {
    const original = process.env.USERNAME;
    delete process.env.USERNAME;
    try {
      const p = defaultDaemonPath("win32", "C:/Users/missing");
      expect(p).toBe("\\\\.\\pipe\\nexus.default.sock");
    } finally {
      if (original !== undefined) process.env.USERNAME = original;
    }
  });

  it("returns a unix socket path on Linux / macOS", () => {
    // path.join uses the host separator; normalize for assertion so the
    // test passes on Windows hosts CI matrix too.
    const norm = (p: string): string => p.replace(/\\/g, "/");
    expect(norm(defaultDaemonPath("linux", "/home/alice"))).toContain(
      ".nexus/run/nexus.sock",
    );
    expect(norm(defaultDaemonPath("darwin", "/Users/bob"))).toContain(
      ".nexus/run/nexus.sock",
    );
  });
});

describe("discoverDesktopDaemon", () => {
  it("returns mode=proxy when the probe path exists", () => {
    const result = discoverDesktopDaemon({
      probePath: "/tmp/fake",
      existsFn: () => true,
    });
    expect(result.mode).toBe("proxy");
    expect(result.detected).toBe(true);
    expect(result.reason).toContain("present");
  });

  it("returns extension-only fallback when daemon is absent and user opted in", () => {
    const result = discoverDesktopDaemon({
      probePath: "/tmp/fake",
      existsFn: () => false,
      extensionOnlyOptIn: true,
    });
    expect(result.mode).toBe("extension-only");
    expect(result.reason).toContain("opted into");
  });

  it("returns extension-only with install hint when daemon is absent and no opt-in", () => {
    const result = discoverDesktopDaemon({
      probePath: "/tmp/fake",
      existsFn: () => false,
    });
    expect(result.mode).toBe("extension-only");
    expect(result.reason).toContain("install hint");
  });

  it("swallows existence-check errors and treats them as absent", () => {
    const result = discoverDesktopDaemon({
      probePath: "/tmp/fake",
      existsFn: () => {
        throw new Error("EACCES");
      },
    });
    expect(result.detected).toBe(false);
  });

  it("threads the resolved path through the result for logging", () => {
    const result = discoverDesktopDaemon({
      probePath: "/tmp/named.pipe",
      existsFn: () => false,
    });
    expect(result.probedPath).toBe("/tmp/named.pipe");
  });

  it("uses the platform / home overrides for default path resolution", () => {
    const result = discoverDesktopDaemon({
      platformOverride: "linux",
      homeDirOverride: "/home/bob",
      existsFn: () => false,
    });
    const norm = result.probedPath.replace(/\\/g, "/");
    expect(norm).toContain("/home/bob");
    expect(norm).toContain(".nexus/run/nexus.sock");
  });
});
