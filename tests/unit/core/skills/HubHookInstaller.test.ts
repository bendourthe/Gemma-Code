import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HubHookInstaller } from "../../../../core/skills/HubHookInstaller.js";

describe("HubHookInstaller (HUB.P3.HOOK)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-hooks-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeHook(file: string, body = "#!/usr/bin/env bash\necho hi\n"): void {
    fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "hooks", file), body, "utf-8");
  }

  it("lists hook scripts classified by platform, sorted, ignoring non-scripts", () => {
    writeHook("git-guardrails.sh");
    writeHook("session-start.ps1");
    writeHook("format-bash-description.py");
    writeHook("settings.json"); // ignored (not a script ext)
    const installer = new HubHookInstaller(path.join(dir, "hooks"));
    const list = installer.list();
    expect(list.map((h) => h.file)).toEqual([
      "format-bash-description.py",
      "git-guardrails.sh",
      "session-start.ps1",
    ]);
    expect(list.find((h) => h.file === "git-guardrails.sh")!.platform).toBe("sh");
    expect(list.find((h) => h.file === "git-guardrails.sh")!.name).toBe("git-guardrails");
  });

  it("installs a hook into the target dir and returns the path", () => {
    writeHook("git-guardrails.sh");
    const installer = new HubHookInstaller(path.join(dir, "hooks"));
    const target = path.join(dir, "target");
    const written = installer.install("git-guardrails.sh", target);
    expect(written).toBe(path.join(target, "git-guardrails.sh"));
    expect(fs.existsSync(written!)).toBe(true);
    expect(fs.readFileSync(written!, "utf-8")).toContain("echo hi");
  });

  it("returns null for a missing hook and rejects path traversal", () => {
    writeHook("git-guardrails.sh");
    const installer = new HubHookInstaller(path.join(dir, "hooks"));
    expect(installer.install("nope.sh", path.join(dir, "t"))).toBeNull();
    expect(installer.install("../escape.sh", path.join(dir, "t"))).toBeNull();
  });

  it("is inert when the hooks dir is null or missing", () => {
    expect(new HubHookInstaller(null).list()).toEqual([]);
    expect(new HubHookInstaller(path.join(dir, "nope")).list()).toEqual([]);
    expect(new HubHookInstaller(null).install("x.sh", dir)).toBeNull();
  });
});
