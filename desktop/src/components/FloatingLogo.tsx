export type FloatingLogoGlow = "sm" | "md" | "lg";

export interface FloatingLogoProps {
  /** Transparent brand mark. Defaults to the alpha-preserving window icon. */
  src?: string;
  /** Rendered square size in px. */
  size?: number;
  alt?: string;
  /** Glow strength; maps to the `--glow-*` drop-shadow tokens. */
  glow?: FloatingLogoGlow;
  className?: string;
  "data-testid"?: string;
}

const GLOW_TOKEN: Record<FloatingLogoGlow, string> = {
  sm: "var(--glow-sm)",
  md: "var(--glow-md)",
  lg: "var(--glow-lg)",
};

/**
 * Floating, glowing Nexus mark (v1.9.0 T203). Fed the transparent brand mark,
 * it applies the cyan drop-shadow glow token and a slow vertical bob via the
 * `nexus-float` keyframes in globals.css. The keyframes are disabled under
 * `prefers-reduced-motion`, leaving a static glowing mark.
 */
export function FloatingLogo({
  src = "/icons/window-icon.png",
  size = 112,
  alt = "Nexus AI Studio",
  glow = "lg",
  className,
  ...rest
}: FloatingLogoProps): JSX.Element {
  const classes = ["nexus-floating-logo", className].filter(Boolean).join(" ");
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={classes}
      data-testid={rest["data-testid"] ?? "floating-logo"}
      style={{
        display: "block",
        width: size,
        height: size,
        filter: `drop-shadow(${GLOW_TOKEN[glow]})`,
      }}
    />
  );
}
