/**
 * Internal surface-liveness beam (v1.17.0 Phase 3). Reverse-engineered
 * traveling / breathing border-beam: CSS `@property` conic gradient, no
 * `border-beam` package, Nexus accents only (no ocean/sunset palettes).
 */

import type { CSSProperties, ReactNode } from "react";
import { useActiveMotionSurface, useAllowsMotion, useReducedMotion } from "../motion";

export type AccentBeamMode = "breathing" | "traveling";

export type AccentBeamAccentToken =
  | "--accent-coding"
  | "--accent-chatbot"
  | "--accent-image"
  | "--accent-video";

export type AccentBeamRadiusToken = "--radius-sm" | "--radius-md" | "--radius-lg" | "--radius-xl";

export interface AccentBeamProps {
  children: ReactNode;
  /** Breathing = focus pulse. Traveling = streaming / rendering chase. */
  mode?: AccentBeamMode;
  accentToken?: AccentBeamAccentToken;
  radiusToken?: AccentBeamRadiusToken;
  /** 0-1 opacity of the beam while playing. */
  strength?: number;
  /** Play/pause with a CSS fade. False leaves a quiet wrapper. */
  playing?: boolean;
  surfaceId: string;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/**
 * Wraps a surface and paints a 1px accent beam on its border box. Registers
 * recede-when-active while `playing`. Under reduced-motion the animation
 * halts and a static accent border remains while playing.
 */
export function AccentBeam({
  children,
  mode = "breathing",
  accentToken = "--accent-coding",
  radiusToken = "--radius-md",
  strength = 0.8,
  playing = false,
  surfaceId,
  className,
  style,
  ...rest
}: AccentBeamProps): JSX.Element {
  const reduce = useReducedMotion();
  const allowed = useAllowsMotion("beam");
  const effectivePlaying = playing && allowed;
  useActiveMotionSurface(surfaceId, effectivePlaying);
  const clamped = Math.min(1, Math.max(0, strength));
  const testId = rest["data-testid"] ?? "accent-beam";
  const classes = ["nexus-accent-beam", className].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      data-testid={testId}
      data-beam-mode={mode}
      data-beam-playing={effectivePlaying ? "true" : "false"}
      data-beam-accent={accentToken}
      data-reduced-motion={reduce ? "true" : "false"}
      style={{
        ...style,
        ["--nexus-beam-color" as string]: `var(${accentToken})`,
        ["--nexus-beam-strength" as string]: String(clamped),
        ["--nexus-beam-radius" as string]: `var(${radiusToken})`,
        borderRadius: `var(${radiusToken})`,
      }}
    >
      {children}
    </div>
  );
}
