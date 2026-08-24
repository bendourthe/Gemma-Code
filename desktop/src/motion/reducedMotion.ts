/**
 * Shared prefers-reduced-motion helpers (v1.17.0 Phase 1).
 *
 * One source of truth for JS-driven motion. CSS animations read the matching
 * `@media (prefers-reduced-motion: reduce)` block in globals.css. Safe when
 * `window` or `matchMedia` is absent (SSR / incomplete jsdom stubs).
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => void;
};

/** True when the platform requests reduced motion. Safe when matchMedia is absent. */
export function getPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/** Alias kept so call sites and constellation tests can share one name. */
export const prefersReducedMotion = getPrefersReducedMotion;

/**
 * Subscribe to reduced-motion changes. Returns an unsubscribe function.
 * No-ops when matchMedia (or its listener APIs) is missing.
 */
export function subscribePrefersReducedMotion(listener: (matches: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia(REDUCED_MOTION_QUERY) as LegacyMediaQueryList;
  const onChange = (event: MediaQueryListEvent): void => {
    listener(event.matches);
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  if (typeof mql.addListener === "function") {
    mql.addListener(onChange);
    return () => {
      mql.removeListener?.(onChange);
    };
  }
  return () => {};
}
