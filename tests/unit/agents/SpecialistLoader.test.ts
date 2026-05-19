import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpecialistLoader, __testing } from "../../../src/agents/SpecialistLoader.js";
import type {
  Specialist,
  SpecialistLoadEventSink,
  SpecialistProvenance,
} from "../../../src/agents/SpecialistLoader.js";
import { getSubAgentInstructions } from "../../../src/agents/SubAgentPrompts.js";

const ASSETS_DIR = path.resolve(__dirname, "../../../assets/specialists");

class CapturingSink implements SpecialistLoadEventSink {
  readonly events: { event: string; payload: unknown }[] = [];
  emit(event: "specialist.loaded", payload: { role: string; provenance: SpecialistProvenance }): void {
    this.events.push({ event, payload });
  }
}

describe("SpecialistLoader", () => {
  describe("frontmatter parser", () => {
    it("parses scalar, block-list, and inline-list values", () => {
      const md = `---
role: research
modelTier: balanced
toolScope:
  - read_file
  - grep_codebase
extra: ["a", "b"]
---
Body text.`;
      const result = __testing.parseFrontmatter(md);
      expect(result).not.toBeNull();
      expect(result?.meta["role"]).toBe("research");
      expect(result?.meta["modelTier"]).toBe("balanced");
      expect(result?.meta["toolScope"]).toEqual(["read_file", "grep_codebase"]);
      expect(result?.meta["extra"]).toEqual(["a", "b"]);
      expect(result?.body).toBe("Body text.");
    });

    it("returns null on missing frontmatter", () => {
      expect(__testing.parseFrontmatter("no frontmatter here")).toBeNull();
    });
  });

  describe("priority chain", () => {
    let workspace: string;
    beforeEach(() => {
      workspace = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-specialist-"));
    });
    afterEach(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
    });

    it("loads from workspace override when present", async () => {
      const overrideDir = path.join(workspace, ".nexus", "specialists");
      fs.mkdirSync(overrideDir, { recursive: true });
      const customBody = "You are a custom override research agent.";
      fs.writeFileSync(
        path.join(overrideDir, "research.md"),
        `---
role: research
modelTier: balanced
toolScope:
  - read_file
---
${customBody}
`,
        "utf-8",
      );

      const loader = new SpecialistLoader(ASSETS_DIR, workspace);
      const specialist = await loader.load("research");

      expect(specialist.provenance).toBe("workspace");
      expect(specialist.systemPrompt).toBe(customBody);
      expect(specialist.toolScope).toEqual(["read_file"]);
    });

    it("loads bundled when no workspace override", async () => {
      const loader = new SpecialistLoader(ASSETS_DIR, workspace);
      const specialist = await loader.load("research");
      expect(specialist.provenance).toBe("bundled");
      expect(specialist.systemPrompt.length).toBeGreaterThan(0);
    });

    it("falls back to hardcoded when both bundled and workspace are missing", async () => {
      const emptyBundled = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-empty-bundled-"));
      try {
        const loader = new SpecialistLoader(emptyBundled, workspace);
        const specialist = await loader.load("planning");
        expect(specialist.provenance).toBe("hardcoded");
        expect(specialist.systemPrompt).toBe(getSubAgentInstructions("planning"));
      } finally {
        fs.rmSync(emptyBundled, { recursive: true, force: true });
      }
    });

    it("falls through to bundled when workspace override is malformed", async () => {
      const overrideDir = path.join(workspace, ".nexus", "specialists");
      fs.mkdirSync(overrideDir, { recursive: true });
      fs.writeFileSync(
        path.join(overrideDir, "research.md"),
        "this file has no yaml frontmatter and should be rejected",
        "utf-8",
      );
      const loader = new SpecialistLoader(ASSETS_DIR, workspace);
      const specialist = await loader.load("research");
      expect(specialist.provenance).toBe("bundled");
    });

    it("rejects unknown modelTier values via Zod", async () => {
      const overrideDir = path.join(workspace, ".nexus", "specialists");
      fs.mkdirSync(overrideDir, { recursive: true });
      fs.writeFileSync(
        path.join(overrideDir, "research.md"),
        `---
role: research
modelTier: ridiculous
toolScope:
  - read_file
---
Body.`,
        "utf-8",
      );
      const loader = new SpecialistLoader(ASSETS_DIR, workspace);
      const specialist = await loader.load("research");
      // override fails Zod -> falls through to bundled
      expect(specialist.provenance).toBe("bundled");
    });
  });

  describe("provenance event sink", () => {
    it("emits specialist.loaded for each load", async () => {
      const sink = new CapturingSink();
      const loader = new SpecialistLoader(ASSETS_DIR, null, sink);
      await loader.load("research");
      await loader.load("verification");
      expect(sink.events).toHaveLength(2);
      expect(sink.events[0]).toEqual({
        event: "specialist.loaded",
        payload: { role: "research", provenance: "bundled" },
      });
      expect(sink.events[1]).toEqual({
        event: "specialist.loaded",
        payload: { role: "verification", provenance: "bundled" },
      });
    });

    it("does not crash when the event sink throws", async () => {
      const throwing: SpecialistLoadEventSink = {
        emit() {
          throw new Error("sink failure");
        },
      };
      const loader = new SpecialistLoader(ASSETS_DIR, null, throwing);
      const specialist = await loader.load("research");
      expect(specialist.provenance).toBe("bundled");
    });
  });

  describe("byte-equivalence between bundled and hardcoded paths", () => {
    it("bundled research prompt equals hardcoded fallback", async () => {
      const loader = new SpecialistLoader(ASSETS_DIR, null);
      const specialist: Specialist = await loader.load("research");
      expect(specialist.systemPrompt).toBe(getSubAgentInstructions("research"));
    });

    it("bundled verification prompt equals hardcoded fallback", async () => {
      const loader = new SpecialistLoader(ASSETS_DIR, null);
      const specialist = await loader.load("verification");
      expect(specialist.systemPrompt).toBe(getSubAgentInstructions("verification"));
    });

    it("bundled planning prompt equals hardcoded fallback", async () => {
      const loader = new SpecialistLoader(ASSETS_DIR, null);
      const specialist = await loader.load("planning");
      expect(specialist.systemPrompt).toBe(getSubAgentInstructions("planning"));
    });
  });
});
