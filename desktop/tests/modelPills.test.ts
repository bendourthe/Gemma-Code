/**
 * v2.2.9 Phase 5 (T010) -- golden name-row pill strings (WN-7 dual-assert).
 *
 * buildModelPills must reproduce tests/fixtures/v2.2.9-model-pills.json
 * exactly, matching the installer's derive_fact_pills
 * (scripts/installer/tests/test_model_pills.py). Missing source values omit
 * the pill -- never Unknown, never an invented Community.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildModelPills,
  compactCapabilityFacts,
  compactRequirementFacts,
  formatContextWindowPill,
  formatReleasedPill,
  multimodalPillValue,
  type PillSource,
} from "../src/shared/models/modelPills";

const FIXTURE = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../tests/fixtures/v2.2.9-model-pills.json",
    ),
    "utf8",
  ),
) as {
  cases: { name: string; model: PillSource; expected: string[] }[];
};

describe("modelPills", () => {
  it("matches every golden fixture case, in the locked pill order", () => {
    for (const { name, model, expected } of FIXTURE.cases) {
      expect(buildModelPills(model), name).toEqual(expected);
    }
  });

  it("formats Released as ASCII en-US Month YYYY and omits invalid dates", () => {
    expect(formatReleasedPill("2025-01-15")).toBe("Released: January 2025");
    expect(formatReleasedPill("2026-12")).toBe("Released: December 2026");
    expect(formatReleasedPill("")).toBeNull();
    expect(formatReleasedPill("2026")).toBeNull();
    expect(formatReleasedPill("2026-13-01")).toBeNull();
    // ASCII-only month names (no locale surprises).
    // eslint-disable-next-line no-control-regex
    expect(formatReleasedPill("2026-05-01")).toMatch(/^[\x20-\x7e]+$/);
  });

  it("formats the context window pill and omits missing windows", () => {
    expect(formatContextWindowPill(262144)).toBe("Context window: 262k tokens");
    expect(formatContextWindowPill(2048)).toBe("Context window: 2k tokens");
    expect(formatContextWindowPill(512)).toBe("Context window: 512 tokens");
    expect(formatContextWindowPill(0)).toBeNull();
  });

  it("derives Multimodal from modalities beyond text or vision, tri-state", () => {
    expect(multimodalPillValue(undefined, undefined)).toBeNull();
    expect(multimodalPillValue(["text"], undefined)).toBe(false);
    expect(multimodalPillValue(["text", "image"], undefined)).toBe(true);
    expect(multimodalPillValue(undefined, true)).toBe(true);
    expect(multimodalPillValue(undefined, false)).toBe(false);
  });

  it("never renders Unknown or Community for an unmapped or Community family", () => {
    const pills = buildModelPills({
      family: "totally-new-lab",
      task: "chat",
      type: "llm",
    });
    expect(pills).toEqual(["Agentic: No"]);
    const community = buildModelPills({
      family: "kokoro",
      task: "audio",
      type: "audio",
    });
    expect(
      community.some((p) => p.includes("Community") || p.includes("Unknown")),
    ).toBe(false);
  });

  it("splits requirements and capabilities without inventing missing chips", () => {
    expect(
      compactRequirementFacts({
        family: "unknown-lab",
        storageLabel: null,
      }),
    ).toEqual([]);
    expect(
      compactRequirementFacts({
        family: "gemma4",
        vramGB: 11,
        origin: "USA",
        releaseDate: "2026-05-01",
        storageLabel: "7.6 GB",
      }),
    ).toEqual([
      "Storage (7.6 GB)",
      "VRAM (11 GB)",
      "Company: Google",
      "Country: USA",
      "Released: May 2026",
    ]);
    expect(
      compactCapabilityFacts({
        family: "gemma4",
        task: "chat",
        type: "llm",
        agentic: true,
        contextWindow: 262144,
        modalities: ["text", "image"],
        vision: true,
        uncensored: false,
        license: "Gemma Terms of Use",
      }),
    ).toEqual([
      "Agentic: Yes",
      "Context window: 262k tokens",
      "Multimodal: Yes",
      "Guardrails: Censored",
      "License: Gemma Terms of Use",
    ]);
  });
});
