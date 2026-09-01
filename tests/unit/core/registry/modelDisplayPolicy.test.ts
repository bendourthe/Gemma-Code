import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalModelDisplayOrder,
  installedOutsideCatalog,
} from "../../../../core/registry/modelDisplayPolicy.js";
import { catalogFingerprint } from "../../../../core/registry/catalogFingerprint.js";

const fixture = JSON.parse(
  readFileSync("tests/fixtures/v2.4.1-model-display-order.json", "utf8"),
) as {
  catalog: { models: Array<{ id: string; displayName: string; task?: string; type: string; source?: string; releaseDate: string; tags: string[] }> };
  expectedIds: string[];
  expectedOutsideIds: string[];
  expectedFingerprint: string;
};

describe("v2.4.1 model display policy", () => {
  it("keeps every selectable row in canonical order", () => {
    expect(canonicalModelDisplayOrder(fixture.catalog.models).map((row) => row.id)).toEqual(fixture.expectedIds);
  });

  it("moves incompatible rows below every compatible row", () => {
    const rows = [
      { id: "new-required-over", displayName: "New Required", task: "agentic", type: "llm", tags: ["required"], vramGB: 24, releaseDate: "2026-08-01" },
      { id: "older-compatible", displayName: "Older Compatible", task: "agentic", type: "llm", tags: [], vramGB: 8, releaseDate: "2025-01-01" },
    ];
    expect(canonicalModelDisplayOrder(rows, { hostVramGB: 16, gpuVendor: "nvidia" }).map((row) => row.id)).toEqual([
      "older-compatible",
      "new-required-over",
    ]);
  });

  it("separates external and dependency-only rows", () => {
    expect(installedOutsideCatalog(fixture.catalog.models).map((row) => row.id)).toEqual(fixture.expectedOutsideIds);
  });

  it("matches the cross-language catalog fingerprint", () => {
    expect(catalogFingerprint(fixture.catalog)).toBe(fixture.expectedFingerprint);
  });
});
