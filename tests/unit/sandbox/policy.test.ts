import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SECRET_DIR_NAMES,
  deriveDefaultPolicy,
} from "../../../modules/coding/sandbox/policy.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("deriveDefaultPolicy", () => {
  it("sets writable roots to workspace + temp and denies network by default", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-policy-ws-"));
    temps.push(workspace);
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-policy-tmp-"));
    temps.push(tmpDir);
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "nexus-policy-home-"));
    temps.push(homeDir);
    mkdirSync(path.join(homeDir, ".ssh"));

    const policy = deriveDefaultPolicy(workspace, { tmpDir, homeDir });

    expect(policy.workspaceRoot).toBe(workspace);
    expect(policy.writableRoots).toContain(workspace);
    expect(policy.writableRoots).toContain(tmpDir);
    expect(policy.network).toBe("deny");
    expect(policy.maxProcesses).toBeGreaterThan(0);
    expect(policy.maxMemoryBytes).toBeGreaterThan(0);
    expect(policy.denyReadRoots.some((p) => p.endsWith(`${path.sep}.ssh`))).toBe(true);
  });

  it("does not deny-read a secret dir that lives inside the workspace", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-policy-ws-"));
    temps.push(workspace);
    mkdirSync(path.join(workspace, ".ssh"));
    const policy = deriveDefaultPolicy(workspace, { homeDir: workspace });
    expect(policy.denyReadRoots).toEqual([]);
  });

  it("keeps extra writable roots that exist and ignores missing ones", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-policy-ws-"));
    temps.push(workspace);
    const extra = mkdtempSync(path.join(os.tmpdir(), "nexus-policy-extra-"));
    temps.push(extra);
    const missing = path.join(os.tmpdir(), "nexus-policy-missing-nope");
    const policy = deriveDefaultPolicy(workspace, {
      extraWritableRoots: [extra, missing],
    });
    expect(policy.writableRoots).toContain(extra);
    expect(policy.writableRoots).not.toContain(missing);
  });

  it("exports the secret dir names the sandbox and denylist share", () => {
    expect(DEFAULT_SECRET_DIR_NAMES).toContain(".ssh");
    expect(DEFAULT_SECRET_DIR_NAMES).toContain(".aws");
  });
});
