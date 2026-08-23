/**
 * v2.2.1 Phase 4 -- token-driven text input (and textarea variant).
 *
 * Native elements, restyled. Same tokens as Select so Settings fields match
 * the Models filters instead of drawing OS chrome on a dark app.
 */

import type { CSSProperties, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

import { CONTROL_CLASS, controlSurface } from "./Select";

type Shared = {
  label?: string;
  testId?: string;
  value: string;
  onChange: (value: string) => void;
};

export interface TextFieldProps
  extends Shared,
    Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  multiline?: false;
}

export interface TextAreaFieldProps
  extends Shared,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  multiline: true;
}

const fieldStyle: CSSProperties = {
  ...controlSurface,
  width: "100%",
  cursor: "text",
};

export function TextField(props: TextFieldProps | TextAreaFieldProps): JSX.Element {
  if (props.multiline) {
    const { label, testId, value, onChange, style, multiline: _m, ...rest } = props;
    return (
      <textarea
        className={CONTROL_CLASS}
        data-testid={testId}
        aria-label={label ?? rest["aria-label"]}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
        style={{ ...fieldStyle, resize: "vertical", ...style }}
      />
    );
  }
  const { label, testId, value, onChange, style, multiline: _m, type = "text", ...rest } = props;
  return (
    <input
      type={type}
      className={CONTROL_CLASS}
      data-testid={testId}
      aria-label={label ?? rest["aria-label"]}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
      style={{ ...fieldStyle, ...style }}
    />
  );
}
