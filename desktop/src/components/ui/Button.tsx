/**
 * v2.2.1 Phase 4 -- token-driven action control.
 *
 * Native `<button>` restyled to match Select / SearchInput. A custom div
 * button would have to re-earn keyboard activation and form submit; this
 * keeps both.
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

import { CONTROL_CLASS, controlSurface } from "./Select";

export type ButtonVariant = "primary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  testId?: string;
  busy?: boolean;
  children: ReactNode;
}

const variantStyle: Record<ButtonVariant, CSSProperties> = {
  primary: {
    ...controlSurface,
    cursor: "pointer",
    width: "auto",
    whiteSpace: "nowrap",
  },
  ghost: {
    ...controlSurface,
    backgroundColor: "transparent",
    cursor: "pointer",
    width: "auto",
    whiteSpace: "nowrap",
  },
  danger: {
    ...controlSurface,
    borderColor: "var(--status-err)",
    color: "var(--status-err)",
    cursor: "pointer",
    width: "auto",
    whiteSpace: "nowrap",
  },
};

export function Button({
  variant = "primary",
  testId,
  busy,
  disabled,
  style,
  children,
  type = "button",
  ...rest
}: ButtonProps): JSX.Element {
  const isDisabled = Boolean(disabled || busy);
  return (
    <button
      type={type}
      className={CONTROL_CLASS}
      data-testid={testId}
      {...rest}
      disabled={isDisabled}
      aria-busy={busy ? true : undefined}
      style={{ ...variantStyle[variant], ...style }}
    >
      {children}
    </button>
  );
}
