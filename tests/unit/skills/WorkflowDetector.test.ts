import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  WorkflowDetector,
  slugifyTools,
  renderProposedSkill,
  type WorkflowProposal,
} from "../../../modules/coding/skills/WorkflowDetector.js";
import type { EpisodicEntry } from "../../../src/storage/MemoryLayers.types.js";

function makeEvent(
  sessionId: string,
  action: string,
  timestamp: number,
): EpisodicEntry {
  return {
    id: `${sessionId}-${action}-${timestamp}`,
    sessionId,
    action,
    context: "ctx",
    outcome: "ok",
    timestamp,
    provenance: {
      source: "tool_verified",
      sourceSessionId: sessionId,
      sourceMessageId: null,
      timestamp,
      confidence: 1,
    },
    tags: [],
  };
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-detector-test-"));
}

describe("WorkflowDetector", () => {
  it("returns no proposals when no sequence recurs enough times", () => {
    const events = [
      makeEvent("s1", "read_file", 1),
      makeEvent("s1", "write_file", 2),
      makeEvent("s1", "run_test", 3),
    ];
    const detector = new WorkflowDetector({ minRecurrence: 3, now: () => 100 });
    expect(detector.detect(events)).toEqual([]);
  });

  it("proposes a workflow after the 3rd recurrence within the window", () => {
    const sequence = ["read_file", "edit_file", "run_test"];
    const events: EpisodicEntry[] = [];
    for (let session = 0; session < 3; session++) {
      for (let i = 0; i < sequence.length; i++) {
        const action = sequence[i];
        if (action !== undefined) {
          events.push(makeEvent(`s${session}`, action, session * 10 + i));
        }
      }
    }
    const detector = new WorkflowDetector({ minRecurrence: 3, now: () => 1_000 });
    const proposals = detector.detect(events);
    const match = proposals.find((p) => p.tools.join("|") === sequence.join("|"));
    expect(match).toBeDefined();
    expect(match?.recurrences).toBe(3);
  });

  it("filters out events outside the lookback window", () => {
    const events = [
      makeEvent("s0", "a", 1),
      makeEvent("s0", "b", 2),
      makeEvent("s0", "c", 3),
      makeEvent("s1", "a", 4),
      makeEvent("s1", "b", 5),
      makeEvent("s1", "c", 6),
      makeEvent("s2", "a", 7),
      makeEvent("s2", "b", 8),
      makeEvent("s2", "c", 9),
    ];
    const detector = new WorkflowDetector({
      minRecurrence: 3,
      windowMs: 5,
      now: () => 9,
    });
    // With windowMs=5 and now=9, cutoff=4: events at 1,2,3 are filtered.
    const proposals = detector.detect(events);
    const seq = proposals.find((p) => p.tools.join("|") === "a|b|c");
    expect(seq).toBeUndefined();
  });

  it("does not cross session boundaries when extracting sequences", () => {
    const events = [
      makeEvent("s1", "a", 1),
      makeEvent("s1", "b", 2),
      makeEvent("s2", "c", 3),
    ];
    const detector = new WorkflowDetector({ minRecurrence: 1, now: () => 100 });
    const proposals = detector.detect(events);
    expect(proposals.find((p) => p.tools.join("|") === "a|b|c")).toBeUndefined();
  });

  it("writeProposedSkill lands a SKILL.md draft under proposed/", () => {
    const dir = tempDir();
    const detector = new WorkflowDetector();
    const proposal: WorkflowProposal = {
      tools: ["read_file", "edit_file", "run_test"],
      recurrences: 3,
      firstSeen: 1,
      lastSeen: 100,
      slug: slugifyTools(["read_file", "edit_file", "run_test"]),
    };
    const written = detector.writeProposedSkill(proposal, dir);
    expect(written).toContain(path.join("proposed", proposal.slug, "SKILL.md"));
    const body = fs.readFileSync(written, "utf-8");
    expect(body).toContain("name:");
    expect(body).toContain("read_file -> edit_file -> run_test");
  });
});

describe("slugifyTools", () => {
  it("normalizes tool names to a kebab-case slug bounded at 80 chars", () => {
    expect(slugifyTools(["Read_File", "Edit_File"])).toBe("read-file-edit-file");
    const long = Array.from({ length: 30 }, () => "tool");
    expect(slugifyTools(long).length).toBeLessThanOrEqual(80);
  });
});

describe("renderProposedSkill", () => {
  it("emits valid YAML frontmatter with name + description", () => {
    const proposal: WorkflowProposal = {
      tools: ["a", "b", "c"],
      recurrences: 4,
      firstSeen: 1,
      lastSeen: 2,
      slug: "abc",
    };
    const md = renderProposedSkill(proposal);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: abc");
    expect(md).toMatch(/description:.*4 times/);
  });
});
