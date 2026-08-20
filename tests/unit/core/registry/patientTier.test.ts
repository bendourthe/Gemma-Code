import { describe, it, expect } from "vitest";
import {
  PATIENT_TIER_DEFAULT_TIMEOUT_MS,
  PATIENT_TIER_LATENCY_WARNING,
  PATIENT_TIER_RAM_PRESETS,
  PATIENT_TIER_TAG,
  isPatientTierModelVisible,
  isPatientTierSpec,
  patientRamPresetById,
  resolvePatientTimeoutMs,
} from "../../../../core/registry/patientTier.js";

describe("patientTier -- tier tag + visibility gate (E1/E3)", () => {
  it("recognizes the patient-tier tag", () => {
    expect(isPatientTierSpec({ tags: [PATIENT_TIER_TAG, "chat"] })).toBe(true);
    expect(isPatientTierSpec({ tags: ["chat"] })).toBe(false);
    expect(isPatientTierSpec({ tags: undefined })).toBe(false);
  });

  it("hides a patient-tier entry unless the tier is enabled; other entries are unaffected", () => {
    const patient = { tags: [PATIENT_TIER_TAG] };
    const ordinary = { tags: ["chat"] };
    expect(isPatientTierModelVisible(patient, false)).toBe(false);
    expect(isPatientTierModelVisible(patient, true)).toBe(true);
    expect(isPatientTierModelVisible(ordinary, false)).toBe(true);
    expect(isPatientTierModelVisible(ordinary, true)).toBe(true);
  });
});

describe("patientTier -- timeout resolver (E1)", () => {
  it("uses the normal request timeout when the tier is off", () => {
    expect(resolvePatientTimeoutMs({ enabled: false, requestTimeoutMs: 60_000 })).toBe(60_000);
    expect(
      resolvePatientTimeoutMs({ enabled: false, requestTimeoutMs: 60_000, patientTimeoutMs: 9_000_000 }),
    ).toBe(60_000);
  });

  it("uses the (large) patient timeout when on, defaulting to 1 hour", () => {
    expect(resolvePatientTimeoutMs({ enabled: true, requestTimeoutMs: 60_000 })).toBe(
      PATIENT_TIER_DEFAULT_TIMEOUT_MS,
    );
    expect(
      resolvePatientTimeoutMs({ enabled: true, requestTimeoutMs: 60_000, patientTimeoutMs: 120_000 }),
    ).toBe(120_000);
  });

  it("is never shorter than the normal request timeout", () => {
    expect(
      resolvePatientTimeoutMs({ enabled: true, requestTimeoutMs: 5_000_000, patientTimeoutMs: 120_000 }),
    ).toBe(5_000_000);
  });

  it("exposes a 1-hour default and an honest latency warning covering 0.03 tok/s", () => {
    expect(PATIENT_TIER_DEFAULT_TIMEOUT_MS).toBe(3_600_000);
    expect(PATIENT_TIER_LATENCY_WARNING.toLowerCase()).toContain("tokens/sec");
    expect(PATIENT_TIER_LATENCY_WARNING).toContain("0.03");
    expect(PATIENT_TIER_LATENCY_WARNING).toContain("32 seconds/token");
  });
});

describe("patientTier -- RAM-budget presets (v1.19.2 K1)", () => {
  it("ships laptop / workstation / max with measured s/token floors", () => {
    expect(PATIENT_TIER_RAM_PRESETS.map((p) => p.id)).toEqual(["laptop", "workstation", "max"]);
    expect(patientRamPresetById("laptop")?.expectedSecondsPerToken).toBe(32);
    expect(patientRamPresetById("laptop")?.peakRssGB).toBe(8.24);
    expect(patientRamPresetById("workstation")?.expectedSecondsPerToken).toBe(21);
    expect(patientRamPresetById("max")?.peakRssGB).toBe(224);
    expect(patientRamPresetById("max")?.expectedSecondsPerToken).toBe(19);
    for (const preset of PATIENT_TIER_RAM_PRESETS) {
      expect(preset.copy.toLowerCase()).toContain("does not bundle");
    }
  });
});
