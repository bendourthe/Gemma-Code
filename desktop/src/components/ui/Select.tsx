/**
 * v2.2.0 Phase 7 (7.1) -- token-driven form controls.
 *
 * The settings pages rendered bare `<select>` elements, which on Windows draw
 * with the OS chrome: a grey box with a system arrow, sitting inside an
 * otherwise dark app. That is the "looks like Windows 95" the user reported.
 *
 * These wrap the NATIVE elements rather than reimplementing them as div-based
 * listboxes. A custom listbox has to re-earn keyboard navigation, type-ahead,
 * screen-reader semantics, and touch behaviour that the native control already
 * has; restyling keeps all of that and fixes the actual complaint, which is
 * appearance.
 */

import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";

export const CONTROL_CLASS = "nx-control";

/** Shared surface tokens for Select, SearchInput, TextField, and Button. */
export const controlSurface: CSSProperties = {
  backgroundColor: "var(--bg-elevated, #1b1b1b)",
  color: "var(--fg-0)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md, 8px)",
  padding: "var(--space-2, 6px) var(--space-3, 10px)",
  fontSize: "var(--text-sm)",
  fontFamily: "var(--font-sans)",
  outline: "none",
};

const controlBase: CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  ...controlSurface,
  paddingRight: "1.75rem",
  cursor: "pointer",
  width: "100%",
};

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  testId?: string;
}

export function Select({ label, testId, style, children, ...rest }: SelectProps): JSX.Element {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: "100%" }}>
      {/* `testId` is a convenience for new call sites; existing ones pass
          `data-testid` directly through `rest`, so the spread must come LAST
          or it would be overwritten with undefined. */}
      <select
        data-testid={testId}
        aria-label={label ?? rest["aria-label"]}
        className={CONTROL_CLASS}
        {...rest}
        style={{ ...controlBase, ...style }}
      >
        {children}
      </select>
      {/* The native arrow is suppressed by `appearance: none`; this replaces it
          in the app's own palette. Pointer events pass through to the select. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: "0.6rem",
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: "var(--fg-muted)",
          fontSize: "0.7rem",
        }}
      >
        {"▾"}
      </span>
    </span>
  );
}

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  testId?: string;
  style?: CSSProperties;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  testId,
  style,
}: SearchInputProps): JSX.Element {
  return (
    <input
      type="search"
      className={CONTROL_CLASS}
      data-testid={testId}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...controlSurface,
        width: "100%",
        ...style,
      }}
    />
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  testId?: string;
}

/**
 * A styled checkbox. Still a real `<input type="checkbox">` underneath, so it
 * keeps native keyboard and screen-reader behaviour; only the visual is ours.
 */
export function Switch({ checked, onChange, label, disabled, testId }: SwitchProps): JSX.Element {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2, 6px)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontSize: "var(--text-sm)",
        position: "relative",
      }}
    >
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          position: "absolute",
          opacity: 0,
          width: 34,
          height: 18,
          margin: 0,
          cursor: disabled ? "default" : "pointer",
        }}
      />
      <span
        aria-hidden
        style={{
          width: 34,
          height: 18,
          borderRadius: 9,
          backgroundColor: checked ? "var(--accent-chatbot)" : "var(--bg-2, #222)",
          border: "1px solid var(--border-subtle)",
          position: "relative",
          transition: "background-color 120ms ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: checked ? 17 : 1,
            width: 14,
            height: 14,
            borderRadius: "50%",
            backgroundColor: "var(--fg-0)",
            transition: "left 120ms ease",
          }}
        />
      </span>
      <span>{label}</span>
    </label>
  );
}
