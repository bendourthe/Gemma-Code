/**
 * v2.4.8 Phase 4 (T015/T018) -- desktop provider colors mirror the installer.
 *
 * `tests/fixtures/v2.4.8-provider-colors.json` is the single source both
 * sides assert against; installer pytest covers `PROVIDER_COLORS` in
 * `scripts/installer/tests/test_desktop_parity_fixtures.py`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BADGE_DOWNLOADED,
  BADGE_RECOMMENDED,
  PROVIDER_COLORS,
  PROVIDER_FALLBACK,
  providerColor,
  providerTint,
  publisherForFamily,
} from "../src/shared/models/providerColors";

interface ProviderColorsFixture {
  fallback: string;
  badgeRecommended: string;
  badgeDownloaded: string;
  providers: Record<string, string>;
}

const FIXTURE = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../tests/fixtures/v2.4.8-provider-colors.json",
    ),
    "utf8",
  ),
) as ProviderColorsFixture;

describe("providerColors", () => {
  it("matches the shared installer fixture exactly", () => {
    expect({ ...PROVIDER_COLORS }).toEqual(FIXTURE.providers);
    expect(PROVIDER_FALLBACK).toBe(FIXTURE.fallback);
    expect(BADGE_RECOMMENDED).toBe(FIXTURE.badgeRecommended);
    expect(BADGE_DOWNLOADED).toBe(FIXTURE.badgeDownloaded);
  });

  it("keys the color to the publisher so a family shows one color on every tab", () => {
    expect(publisherForFamily("gemma4")).toBe("Google");
    expect(providerColor("gemma4")).toBe("#22d3ee");
    expect(providerColor("embeddinggemma")).toBe("#22d3ee");
    expect(providerColor("qwen3.5")).toBe(providerColor("wan"));
  });

  it("falls back to slate for unknown or community families", () => {
    expect(providerColor(undefined)).toBe(PROVIDER_FALLBACK);
    expect(providerColor("not-a-family")).toBe(PROVIDER_FALLBACK);
    expect(providerColor("kokoro")).toBe(PROVIDER_FALLBACK);
  });

  it("tints with color-mix at a rounded percentage", () => {
    expect(providerTint("#22d3ee", 0.09)).toBe(
      "color-mix(in srgb, #22d3ee 9%, transparent)",
    );
    expect(providerTint("#22d3ee", 0.3)).toBe(
      "color-mix(in srgb, #22d3ee 30%, transparent)",
    );
    expect(providerTint("#22d3ee", 2)).toBe(
      "color-mix(in srgb, #22d3ee 100%, transparent)",
    );
  });
});
