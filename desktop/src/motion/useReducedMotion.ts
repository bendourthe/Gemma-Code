import { useEffect, useState } from "react";
import { getPrefersReducedMotion, subscribePrefersReducedMotion } from "./reducedMotion";

/**
 * React subscription to `prefers-reduced-motion`. SSR/jsdom-safe: defaults to
 * false when `matchMedia` is missing, and does not throw on incomplete stubs.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(getPrefersReducedMotion);

  useEffect(() => {
    setReduced(getPrefersReducedMotion());
    return subscribePrefersReducedMotion(setReduced);
  }, []);

  return reduced;
}
