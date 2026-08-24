import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { primaryMotion, type MotionKind } from "./precedence";

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
 * opacity transition on the ambient layer.
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

export interface MotionSurfaceValue {
  surfaceId: string;
  winner: MotionKind | null;
  candidates: readonly MotionKind[];
}

const MotionSurfaceContext = createContext<MotionSurfaceValue | null>(null);

export interface MotionSurfaceProps {
  surfaceId: string;
  candidates: readonly MotionKind[];
  children: ReactNode;
}

/**
 * Groups nested orb / beam / metal / aurora effects under one precedence
 * winner. Registers recede once for the group. Nested effects read
 * `useAllowsMotion` and skip their own recede registration.
 */
export function MotionSurface({ surfaceId, candidates, children }: MotionSurfaceProps): JSX.Element {
  const winner = primaryMotion(candidates);
  const signature = candidates.join(",");
  // signature stands in for candidates identity so typing does not rebuild context.
  const value = useMemo<MotionSurfaceValue>(
    () => ({ surfaceId, winner, candidates }),
    [surfaceId, winner, signature],
  );
  useActiveMotionSurface(surfaceId, winner !== null);
  return <MotionSurfaceContext.Provider value={value}>{children}</MotionSurfaceContext.Provider>;
}

export function useMotionSurface(): MotionSurfaceValue | null {
  return useContext(MotionSurfaceContext);
}

/** True when this kind is the group winner, or when the effect is not grouped. */
export function useAllowsMotion(kind: MotionKind): boolean {
  const group = useContext(MotionSurfaceContext);
  if (!group) return true;
  return group.winner === kind;
}

/**
 * Declarative registration: a surface calls this with `active` true while it
 * is running an orb / beam / metal effect. Cleanup deactivates on unmount
 * or when `active` flips false. Nested effects inside `MotionSurface` skip
 * this so the group owns the single recede flag.
 */
export function useActiveMotionSurface(id: string, active: boolean): void {
  const grouped = useContext(MotionSurfaceContext);
  const { activate, deactivate } = useMotionActivity();
  useEffect(() => {
    if (grouped) return;
    if (!active) return;
    activate(id);
    return () => deactivate(id);
  }, [id, active, activate, deactivate, grouped]);
}
