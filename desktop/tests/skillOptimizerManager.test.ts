import { describe, expect, it } from "vitest";
import {
  SkillOptimizerManager,
  type SkillOptimizePreviewRunner,
} from "../sidecar/src/coding/skillOptimizerManager";
import type { CapturedSkillEdit } from "../../modules/coding/skilloptimizer/HeadlessOptimizerFactory";
import { IpcMethodError } from "../sidecar/src/protocol";

// v1.12.0 EM.P2.A -- the two-call preview/apply manager. The optimizer run is an
// injected seam, so these exercise the token store + the guardrail (apply writes
// only the exact previewed bytes for a known token+proposal) without a live model.

function fakeRunner(captured: readonly CapturedSkillEdit[]): SkillOptimizePreviewRunner {
  return { run: async () => captured };
}

describe("SkillOptimizerManager (EM.P2.A)", () => {
  it("preview returns a token + proposals and never leaks newContent to the client shape", async () => {
    const mgr = new SkillOptimizerManager({
      runner: fakeRunner([
        { skillId: "nexus-hub/x", skillPath: "/c/x/SKILL.md", diff: "D", newContent: "NEW" },
      ]),
      idFactory: () => "tok-1",
    });
    const res = await mgr.preview({ skillId: "nexus-hub/x" });
    expect(res.token).toBe("tok-1");
    expect(res.proposals).toEqual([
      { id: "0", skillId: "nexus-hub/x", skillPath: "/c/x/SKILL.md", diff: "D" },
    ]);
    expect((res.proposals[0] as unknown as Record<string, unknown>).newContent).toBeUndefined();
  });

  it("apply writes the EXACT previewed content for the chosen proposal", async () => {
    const writes: Array<[string, string]> = [];
    const mgr = new SkillOptimizerManager({
      runner: fakeRunner([
        { skillId: "nexus-hub/x", skillPath: "/c/x/SKILL.md", diff: "D", newContent: "NEW BODY" },
      ]),
      idFactory: () => "tok-1",
      write: (p, c) => writes.push([p, c]),
    });
    const { token, proposals } = await mgr.preview({ skillId: "nexus-hub/x" });
    const res = await mgr.apply({ token, proposalId: proposals[0]!.id });
    expect(res).toEqual({ applied: true, skillId: "nexus-hub/x", skillPath: "/c/x/SKILL.md" });
    expect(writes).toEqual([["/c/x/SKILL.md", "NEW BODY"]]);
  });

  it("apply rejects an unknown token and writes nothing", async () => {
    const writes: Array<[string, string]> = [];
    const mgr = new SkillOptimizerManager({ runner: fakeRunner([]), write: (p, c) => writes.push([p, c]) });
    await expect(mgr.apply({ token: "nope", proposalId: "0" })).rejects.toBeInstanceOf(IpcMethodError);
    expect(writes).toEqual([]);
  });

  it("apply rejects an unknown proposalId and writes nothing", async () => {
    const writes: Array<[string, string]> = [];
    const mgr = new SkillOptimizerManager({
      runner: fakeRunner([{ skillId: "s", skillPath: "/p", diff: "d", newContent: "n" }]),
      idFactory: () => "t",
      write: (p, c) => writes.push([p, c]),
    });
    const { token } = await mgr.preview({ skillId: "s" });
    await expect(mgr.apply({ token, proposalId: "99" })).rejects.toBeInstanceOf(IpcMethodError);
    expect(writes).toEqual([]);
  });

  it("preview on an unconfigured manager fails clearly", async () => {
    const mgr = new SkillOptimizerManager();
    await expect(mgr.preview({ skillId: "s" })).rejects.toBeInstanceOf(IpcMethodError);
  });
});
