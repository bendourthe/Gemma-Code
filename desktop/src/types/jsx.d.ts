// React 19 + `jsx: react-jsx` does not expose a global JSX namespace by
// default. Components in the Nexus codebase annotate their return type as
// `: JSX.Element` for clarity, so we re-expose the namespace from the React
// runtime here.

import type { JSX as ReactJSX } from "react/jsx-runtime";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementType = ReactJSX.ElementType;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}

export {};
