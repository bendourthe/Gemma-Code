import { describe, it, expect, vi } from "vitest";
import { CommandRouter } from "../../../src/commands/CommandRouter.js";
import type { CommandDescriptor } from "../../../src/commands/CommandRouter.js";

function makeRouter(skills: CommandDescriptor[] = []): CommandRouter {
  return new CommandRouter(() => skills);
}

describe("CommandRouter", () => {
  describe("route()", () => {
    it("returns null for regular messages that do not start with /", () => {
      const router = makeRouter();
      expect(router.route("hello world")).toBeNull();
      expect(router.route("tell me about this file")).toBeNull();
    });

    it("returns null for an empty slash", () => {
      const router = makeRouter();
      expect(router.route("/")).toBeNull();
    });

    it("routes /help to a builtin command with empty args", () => {
      const router = makeRouter();
      const cmd = router.route("/help");
      expect(cmd).toEqual({ type: "builtin", name: "help", args: "" });
    });

    it("routes /help with args correctly", () => {
      const router = makeRouter();
      const cmd = router.route("/help commit");
      expect(cmd).toEqual({ type: "builtin", name: "help", args: "commit" });
    });

    it("routes /clear to builtin", () => {
      const router = makeRouter();
      expect(router.route("/clear")).toEqual({ type: "builtin", name: "clear", args: "" });
    });

    it("routes /plan to builtin", () => {
      const router = makeRouter();
      expect(router.route("/plan")).toEqual({ type: "builtin", name: "plan", args: "" });
    });

    it("routes /compact to builtin", () => {
      const router = makeRouter();
      expect(router.route("/compact")).toEqual({ type: "builtin", name: "compact", args: "" });
    });

    it("routes /model to builtin with model name as args", () => {
      const router = makeRouter();
      expect(router.route("/model gemma3:27b")).toEqual({
        type: "builtin",
        name: "model",
        args: "gemma3:27b",
      });
    });

    it("routes a known skill command", () => {
      const router = makeRouter([{ name: "commit", description: "Generate commit" }]);
      const cmd = router.route("/commit fix login bug");
      expect(cmd).toEqual({ type: "skill", name: "commit", args: "fix login bug" });
    });

    it("routes a skill command with no args", () => {
      const router = makeRouter([{ name: "review-pr", description: "Review PR" }]);
      const cmd = router.route("/review-pr");
      expect(cmd).toEqual({ type: "skill", name: "review-pr", args: "" });
    });

    it("returns null and warns for an unknown command", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const router = makeRouter();
      const cmd = router.route("/nonexistent-skill");
      expect(cmd).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("/nonexistent-skill")
      );
      warnSpy.mockRestore();
    });
  });

  describe("getAllDescriptors()", () => {
    it("includes all six built-in commands", () => {
      const router = makeRouter();
      const names = router.getAllDescriptors().map((d) => d.name);
      expect(names).toContain("help");
      expect(names).toContain("clear");
      expect(names).toContain("history");
      expect(names).toContain("plan");
      expect(names).toContain("compact");
      expect(names).toContain("model");
    });

    it("includes skill descriptors returned by the factory", () => {
      const skills: CommandDescriptor[] = [
        { name: "commit", description: "Generate commit message", argumentHint: "[msg]" },
        { name: "review-pr", description: "Review a PR" },
      ];
      const router = makeRouter(skills);
      const names = router.getAllDescriptors().map((d) => d.name);
      expect(names).toContain("commit");
      expect(names).toContain("review-pr");
    });

    it("reflects hot-loaded skills from the factory", () => {
      const skills: CommandDescriptor[] = [];
      const router = new CommandRouter(() => skills);

      expect(router.getAllDescriptors().map((d) => d.name)).not.toContain("new-skill");

      skills.push({ name: "new-skill", description: "New skill" });

      expect(router.getAllDescriptors().map((d) => d.name)).toContain("new-skill");
    });
  });
});
