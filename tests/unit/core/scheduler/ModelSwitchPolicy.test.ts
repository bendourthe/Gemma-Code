/**
 * v2.2.0 Phase 4 (4.1) -- the single-GPU switch decision matrix.
 *
 * The policy is the guard between "user did something" and "the GPU evicts a
 * model someone else is using". These tests pin the whole matrix: resident vs
 * not, fits vs does not fit, idle vs busy, same vs other module, remembered
 * vs not, and the two cases that must never silently swap (unknown VRAM, and
 * a model that is not installed).
 */

import { describe, expect, it } from "vitest";

import {
  CORESIDE_HEADROOM_GB,
  assertNoLoadOnNavigation,
  classifySwitch,
  isImmediate,
  reclassifyOnConfirm,
  rememberKey,
  swapPlanFor,
  toDecisionEvent,
  type SwitchRequest,
} from "../../../../core/scheduler/ModelSwitchPolicy";

const CODING_MODEL = { modelId: "qwen2.5-coder:14b", vramGB: 9 };
const IMAGE_MODEL_VRAM = 3.2;

function request(overrides: Partial<SwitchRequest> = {}): SwitchRequest {
  return {
    targetModelId: "sana-1.6b-2k",
    targetVramGB: IMAGE_MODEL_VRAM,
    requestingModule: "image",
    resident: [CODING_MODEL],
    freeVramGB: 1.0, // tight by default: forces an eviction decision
    activeJob: null,
    installed: true,
    ...overrides,
  };
}

describe("classifySwitch: trivial outcomes", () => {
  it("returns not-installed without proposing any GPU work", () => {
    const verdict = classifySwitch(request({ installed: false }));
    expect(verdict.kind).toBe("not-installed");
    expect(isImmediate(verdict)).toBe(false);
  });

  it("returns resident when the target is already loaded", () => {
    const verdict = classifySwitch(
      request({ resident: [{ modelId: "sana-1.6b-2k", vramGB: 3.2 }] }),
    );
    expect(verdict.kind).toBe("resident");
  });

  it("treats a resident target as resident EVEN WHEN another module is busy", () => {
    // Nothing needs to be evicted, so a busy GPU is not a reason to interrupt.
    const verdict = classifySwitch(
      request({
        resident: [{ modelId: "sana-1.6b-2k", vramGB: 3.2 }],
        activeJob: { moduleId: "coding", jobType: "agent-turn" },
      }),
    );
    expect(verdict.kind).toBe("resident");
  });
});

describe("classifySwitch: nothing loaded", () => {
  it("loads without asking when no model is resident", () => {
    // The dialog protects an incumbent. With none, asking would gate every
    // first generation behind a prompt for no benefit.
    const verdict = classifySwitch(request({ resident: [], freeVramGB: 12 }));
    expect(verdict).toMatchObject({ kind: "auto-switch", evicting: [] });
  });

  it("loads without asking even when VRAM telemetry is unavailable", () => {
    // Regression: this case previously returned `confirm`, which blocked every
    // generation on a host with no telemetry. The scheduler's VRAM gate still
    // refuses a model that genuinely cannot fit.
    const verdict = classifySwitch(request({ resident: [], freeVramGB: null }));
    expect(verdict.kind).toBe("auto-switch");
  });

  it("loads without asking even when another module is busy with no model", () => {
    const verdict = classifySwitch(
      request({
        resident: [],
        freeVramGB: null,
        activeJob: { moduleId: "coding", jobType: "agent-turn" },
      }),
    );
    expect(verdict.kind).toBe("auto-switch");
  });
});

describe("classifySwitch: co-residency", () => {
  it("co-resides when both models fit with the required headroom", () => {
    const verdict = classifySwitch(
      request({ freeVramGB: IMAGE_MODEL_VRAM + CORESIDE_HEADROOM_GB }),
    );
    expect(verdict).toMatchObject({ kind: "coreside", withResident: ["qwen2.5-coder:14b"] });
  });

  it("co-resides without a dialog even while another module is busy", () => {
    // The incumbent is not evicted, so there is nothing to warn about.
    const verdict = classifySwitch(
      request({
        freeVramGB: 8,
        activeJob: { moduleId: "coding", jobType: "agent-turn" },
      }),
    );
    expect(verdict.kind).toBe("coreside");
  });

  it("does NOT co-reside when the fit leaves less than the headroom", () => {
    const verdict = classifySwitch(
      request({ freeVramGB: IMAGE_MODEL_VRAM + CORESIDE_HEADROOM_GB - 0.1 }),
    );
    expect(verdict.kind).not.toBe("coreside");
  });
});

describe("classifySwitch: auto-switch vs confirm", () => {
  it("auto-switches when the GPU is idle and the models do not both fit", () => {
    const verdict = classifySwitch(request({ activeJob: null }));
    expect(verdict).toMatchObject({ kind: "auto-switch", evicting: ["qwen2.5-coder:14b"] });
  });

  it("auto-switches when the only active job is the requesting module's own", () => {
    const verdict = classifySwitch(
      request({ activeJob: { moduleId: "image", jobType: "txt2img" } }),
    );
    expect(verdict.kind).toBe("auto-switch");
  });

  it("confirms when another module is busy and eviction is required", () => {
    const verdict = classifySwitch(
      request({ activeJob: { moduleId: "coding", jobType: "agent-turn" } }),
    );
    expect(verdict).toMatchObject({
      kind: "confirm",
      reason: "other-module-busy",
      busyWith: { moduleId: "coding" },
    });
  });

  it("skips the dialog when the pair was remembered for this session", () => {
    const remembered = new Set([rememberKey("image", "coding", "sana-1.6b-2k")]);
    const verdict = classifySwitch(
      request({
        activeJob: { moduleId: "coding", jobType: "agent-turn" },
        rememberedPairs: remembered,
      }),
    );
    expect(verdict.kind).toBe("auto-switch");
  });

  it("does not let a remembered pair leak to a different target model", () => {
    const remembered = new Set([rememberKey("image", "coding", "some-other-model")]);
    const verdict = classifySwitch(
      request({
        activeJob: { moduleId: "coding", jobType: "agent-turn" },
        rememberedPairs: remembered,
      }),
    );
    expect(verdict.kind).toBe("confirm");
  });

  it("skips the dialog for an agentic tool call the user already consented to", () => {
    const verdict = classifySwitch(
      request({
        requestingModule: "coding",
        activeJob: { moduleId: "coding", jobType: "agent-turn" },
        userAlreadyConsented: true,
      }),
    );
    expect(verdict.kind).toBe("auto-switch");
  });
});

describe("classifySwitch: unknown VRAM", () => {
  it("confirms rather than guessing a fit", () => {
    const verdict = classifySwitch(request({ freeVramGB: null }));
    expect(verdict).toMatchObject({ kind: "confirm", reason: "vram-unknown" });
  });

  it("confirms on unknown VRAM even when another module is busy", () => {
    const verdict = classifySwitch(
      request({
        freeVramGB: null,
        activeJob: { moduleId: "coding", jobType: "agent-turn" },
      }),
    );
    expect(verdict).toMatchObject({ kind: "confirm", reason: "vram-unknown" });
  });

  it("defers (never silently swaps) for a consented agent call with no telemetry", () => {
    // Consent to swap is not consent to a swap we cannot size.
    const verdict = classifySwitch(
      request({ freeVramGB: null, userAlreadyConsented: true, activeJob: null }),
    );
    expect(verdict.kind).toBe("defer");
    expect(isImmediate(verdict)).toBe(false);
  });

  it("treats NaN free VRAM the same as unknown", () => {
    const verdict = classifySwitch(request({ freeVramGB: Number.NaN }));
    expect(verdict.kind).toBe("confirm");
  });
});

describe("reclassifyOnConfirm", () => {
  it("resolves to auto-switch when the busy job finished during the dialog", () => {
    // Regression guard: acting on the ORIGINAL verdict would evict a model
    // the user was warned about but which is no longer in use.
    const original = classifySwitch(
      request({ activeJob: { moduleId: "coding", jobType: "agent-turn" } }),
    );
    expect(original.kind).toBe("confirm");

    const after = reclassifyOnConfirm(request({ activeJob: null }));
    expect(after.kind).toBe("auto-switch");
  });

  it("resolves to resident when the model arrived while the dialog was open", () => {
    const after = reclassifyOnConfirm(
      request({ resident: [{ modelId: "sana-1.6b-2k", vramGB: 3.2 }] }),
    );
    expect(after.kind).toBe("resident");
  });

  it("still refuses a model that is not installed", () => {
    expect(reclassifyOnConfirm(request({ installed: false })).kind).toBe("not-installed");
  });

  it("still refuses to size an unknown-VRAM swap", () => {
    expect(reclassifyOnConfirm(request({ freeVramGB: null })).kind).toBe("defer");
  });
});

describe("swapPlanFor", () => {
  it("defers when telemetry cannot size the swap", () => {
    expect(swapPlanFor(request({ freeVramGB: null })).outcome).toBe("deferred");
  });

  it("honors a swap that fits", () => {
    expect(swapPlanFor(request({ freeVramGB: 12 })).outcome).toBe("honored");
  });
});

describe("navigation guard", () => {
  it("throws if a navigation path ever asks for a model load", () => {
    expect(() => assertNoLoadOnNavigation("navigation")).toThrow(/never request a model load/);
  });

  it("permits submit and agent-tool contexts", () => {
    expect(() => assertNoLoadOnNavigation("submit")).not.toThrow();
    expect(() => assertNoLoadOnNavigation("agent-tool")).not.toThrow();
  });
});

describe("toDecisionEvent", () => {
  it("records the decision for the trace panel", () => {
    const req = request({ activeJob: { moduleId: "coding", jobType: "agent-turn" } });
    const event = toDecisionEvent(req, classifySwitch(req), 1234);
    expect(event).toMatchObject({
      kind: "confirm",
      targetModelId: "sana-1.6b-2k",
      requestingModule: "image",
      busyModule: "coding",
      at: 1234,
    });
  });
});
