import { afterEach, expect, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import "@testing-library/jest-dom/vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
expect.extend(matchers as any);

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
  } catch {
    // no-op when storage is unavailable
  }
});
