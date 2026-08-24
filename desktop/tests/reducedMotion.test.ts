import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REDUCED_MOTION_QUERY,
  getPrefersReducedMotion,
  prefersReducedMotion,
  subscribePrefersReducedMotion,
} from "../src/motion/reducedMotion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPrefersReducedMotion / prefersReducedMotion", () => {
  it("is true when the media query matches", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    expect(getPrefersReducedMotion()).toBe(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("is false when the media query does not match", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(getPrefersReducedMotion()).toBe(false);
  });

  it("is false when matchMedia is missing", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(getPrefersReducedMotion()).toBe(false);
  });
});

describe("subscribePrefersReducedMotion", () => {
  it("notifies listeners on change via addEventListener", () => {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => {
        expect(query).toBe(REDUCED_MOTION_QUERY);
        return {
          matches: false,
          addEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => {
            listeners.push(cb);
          },
          removeEventListener: vi.fn(),
        };
      }),
    );
    const received: boolean[] = [];
    const unsubscribe = subscribePrefersReducedMotion((matches) => received.push(matches));
    listeners[0]!({ matches: true });
    expect(received).toEqual([true]);
    unsubscribe();
  });

  it("falls back to addListener when addEventListener is absent", () => {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    const removeListener = vi.fn((cb: (event: { matches: boolean }) => void) => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addListener: (cb: (event: { matches: boolean }) => void) => {
          listeners.push(cb);
        },
        removeListener,
      })),
    );
    const received: boolean[] = [];
    const unsubscribe = subscribePrefersReducedMotion((matches) => received.push(matches));
    listeners[0]!({ matches: true });
    expect(received).toEqual([true]);
    unsubscribe();
    expect(removeListener).toHaveBeenCalled();
  });

  it("no-ops when matchMedia is missing", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => subscribePrefersReducedMotion(() => {})()).not.toThrow();
  });

  it("no-ops when the media query list has no listener API", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    const unsubscribe = subscribePrefersReducedMotion(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
