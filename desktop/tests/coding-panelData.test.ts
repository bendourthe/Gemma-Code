import { describe, expect, it } from "vitest";
import {
  memorySnapshot,
  redactSecrets,
  traceSubscribe,
} from "../sidecar/src/coding/panelData";

describe("panel data", () => {
  it("memorySnapshot exposes all four layers + anticipated + proposedSkills", () => {
    const { snapshot } = memorySnapshot();
    expect(Object.keys(snapshot.layers).sort()).toEqual([
      "core",
      "project",
      "recent",
      "working",
    ]);
    expect(snapshot.anticipated.length).toBeGreaterThan(0);
    expect(snapshot.proposedSkills.length).toBeGreaterThan(0);
  });

  it("traceSubscribe redacts AWS keys / OpenAI keys / GitHub PATs", () => {
    const payload = redactSecrets(
      "AWS=AKIAABCDEFGHIJKLMNOP gh=ghp_abcdefghijklmnopqrstuvwxyz openai=sk-aaaabbbbccccddddeeee",
    );
    expect(payload).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(payload).not.toMatch(/ghp_/);
    expect(payload).not.toMatch(/sk-aaaa/);
    expect(payload).toContain("<redacted>");
  });

  it("traceSubscribe returns the canned placeholder trace events", () => {
    const { events } = traceSubscribe();
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(["tool", "model", "scheduler", "skill"]).toContain(e.kind);
    }
    const routing = events.find((e) => e.id === "t-003");
    expect(routing?.payload?.kind).toBe("routing.decision");
  });
});
