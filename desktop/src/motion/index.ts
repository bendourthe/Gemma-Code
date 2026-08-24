export {
  REDUCED_MOTION_QUERY,
  getPrefersReducedMotion,
  prefersReducedMotion,
  subscribePrefersReducedMotion,
} from "./reducedMotion";
export { useReducedMotion } from "./useReducedMotion";
export {
  MotionActivityProvider,
  MotionSurface,
  useActiveMotionSurface,
  useAllowsMotion,
  useMotionActivity,
  useMotionSurface,
  type MotionActivityValue,
  type MotionSurfaceValue,
} from "./MotionActivity";
export {
  allowsMotion,
  composerMotionCandidates,
  dockMotionCandidates,
  GENERATION_CANVAS_CANDIDATES,
  MOTION_PRECEDENCE,
  primaryMotion,
  type MotionKind,
} from "./precedence";
