import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HubCommandCatalogLoader } from "../../../modules/coding/commands/HubCommandCatalogLoader.js";
import { CommandRouter } from "../../../modules/coding/commands/CommandRouter.js";

describe("HubCommandCatalogLoader (HUB.P3.CMD)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-cmds-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeCmd(name: string, description: string, body: string): void {
    fs.writeFileSync(
      path.join(dir, `${name}.md`),
      `---\ndescription: ${description}\n---\n${body}`,
      "utf-8",
    );
  }

  it("loads command name/description/body and exposes descriptors", () => {
    writeCmd("compare", "Compare to a source", "# /compare\nDo the comparison.");
    const loader = new HubCommandCatalogLoader(dir);
    expect(loader.get("compare")!.body).toContain("Do the comparison.");
    expect(loader.descriptors()).toEqual([
      { name: "compare", description: "Compare to a source" },
    ]);
  });

  it("is inert when the dir is null or missing", () => {
    expect(new HubCommandCatalogLoader(null).descriptors()).toEqual([]);
    expect(new HubCommandCatalogLoader(path.join(dir, "nope")).get("x")).toBeNull();
  });
});

describe("CommandRouter hub-command routing (HUB.P3.CMD)", () => {
  it("routes a Hub command name to a hub-command after builtins + skills", () => {
    const router = new CommandRouter(
      () => [{ name: "commit", description: "skill" }],
      () => [{ name: "compare", description: "hub" }],
    );
    expect(router.route("/compare src")).toEqual({ type: "hub-command", name: "compare", args: "src" });
    // builtin precedence
    expect(router.route("/help")!.type).toBe("builtin");
    // skill precedence over a same-named hub command
    expect(router.route("/commit msg")!.type).toBe("skill");
  });

  it("merges hub descriptors into getAllDescriptors", () => {
    const router = new CommandRouter(
      () => [],
      () => [{ name: "research", description: "hub research" }],
    );
    expect(router.getAllDescriptors().some((d) => d.name === "research")).toBe(true);
  });

  it("still works with no hub source (back-compat)", () => {
    const router = new CommandRouter(() => []);
    expect(router.route("/unknown")).toBeNull();
  });
});
