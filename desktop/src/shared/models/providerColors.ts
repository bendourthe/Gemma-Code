/**
 * v2.4.8 Phase 4 (T015) -- provider (publisher) colors for model cards.
 *
 * Mirror of installer `nexus_installer.constants.PROVIDER_COLORS`,
 * `PROVIDER_FALLBACK`, `BADGE_RECOMMENDED`, and `BADGE_DOWNLOADED`. The
 * installer picker tints each card with its publisher's color so a Google
 * card and an Alibaba card read differently before a word is read; Settings >
 * Models now draws the same card. Both sides assert equality against
 * `tests/fixtures/v2.4.8-provider-colors.json`, so a change here without the
 * fixture (or the fixture without the installer) fails a test.
 */
import { FAMILY_TO_PUBLISHER } from "./modelPills";

/** Slate: community / unknown publisher. */
export const PROVIDER_FALLBACK = "#94a3b8";

export const PROVIDER_COLORS: Readonly<Record<string, string>> = {
  Google: "#22d3ee",
  Meta: "#60a5fa",
  Alibaba: "#a78bfa",
  DeepSeek: "#818cf8",
  NVIDIA: "#a3e635",
  "Stability AI": "#f472b6",
  "Black Forest Labs": "#fbbf24",
  Lightricks: "#fb923c",
  OpenAI: "#34d399",
  "Nomic AI": "#2dd4bf",
  "Liquid AI": "#38bdf8",
  "Nous Research": "#c084fc",
  "Thinking Machines": "#f97316",
  Community: PROVIDER_FALLBACK,
};

/** Steelblue Recommended pill, as on the installer card. */
export const BADGE_RECOMMENDED = "#4682b4";
/** Violet downloaded badge, as on the installer card. */
export const BADGE_DOWNLOADED = "#a78bfa";

export function publisherForFamily(family: string | undefined): string {
  return (family && FAMILY_TO_PUBLISHER[family]) || "Community";
}

/**
 * Resolve a catalog `family` to its provider color. Keyed to the publisher so
 * a model shows one color across every tab it appears in; unknown families
 * fall back to slate.
 */
export function providerColor(family: string | undefined): string {
  return PROVIDER_COLORS[publisherForFamily(family)] ?? PROVIDER_FALLBACK;
}

/** `color-mix()` tint of a provider color at `alpha` (0-1), for card fills. */
export function providerTint(color: string, alpha: number): string {
  const pct = Math.round(Math.min(Math.max(alpha, 0), 1) * 100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
