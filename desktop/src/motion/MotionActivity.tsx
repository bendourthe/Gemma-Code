import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface MotionActivityValue {
  /** Surface ids that currently run an orb / beam / metal effect. */
  activeIds: ReadonlySet<string>;
  activate: (id: string) => void;
  deactivate: (id: string) => void;
  /** True when any surface has an active effect; the ambient glow should recede. */
  isAmbientReceded: boolean;
}

const noop = (): void => {};

const DEFAULT_VALUE: MotionActivityValue = {
  activeIds: new Set(),
  activate: noop,
  deactivate: noop,
  isAmbientReceded: false,
};

const MotionActivityContext = createContext<MotionActivityValue>(DEFAULT_VALUE);

/**
 * Tracks which surfaces currently run a primary motion effect so the ambient
 * constellation / radial-glow can step back. Cheap: a Set of ids and an
 * opacity transition on the ambient layer. Wiring every surface is Phase 5;
 * Phase 1 ships the primitive plus one reference integration.
 */
export function MotionActivityProvider({ children }: { children: ReactNode }): JSX.Element {
  const [activeIds, setActiveIds] = useState<Set<string>>(() => new Set());

  const activate = useCallback((id: string) => {
    setActiveIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const deactivate = useCallback((id: string) => {
    setActiveIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo<MotionActivityValue>(
    () => ({
      activeIds,
      activate,
      deactivate,
      isAmbientReceded: activeIds.size > 0,
    }),
    [activeIds, activate, deactivate],
  );

  return <MotionActivityContext.Provider value={value}>{children}</MotionActivityContext.Provider>;
}

export function useMotionActivity(): MotionActivityValue {
  return useContext(MotionActivityContext);
}

/**
 * Declarative registration: a surface calls this with `active` true while it
 * is running an orb / beam / metal effect. Cleanup deactivates on unmount
 * or when `active` flips false.
 */
export function useActiveMotionSurface(id: string, active: boolean): void {
  const { activate, deactivate } = useMotionActivity();
  useEffect(() => {
    if (!active) return;
    activate(id);
    return () => deactivate(id);
  }, [id, active, activate, deactivate]);
}
