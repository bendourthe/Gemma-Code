/**
 * v2.2.3 Phase 1 (1.1) -- React error boundary for the routed module pane.
 *
 * Before this, desktop/src had ZERO error boundaries, so any render-time
 * throw in a module (the Chat explorer's sync/async mismatch was the field
 * case, U7) propagated to the React root and blanked the entire app. Mounted
 * around `<Routes>` with a per-route key so a crash degrades to an in-pane
 * error and navigating to another module remounts a clean tree.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ModuleErrorBoundaryProps {
  children: ReactNode;
}

interface ModuleErrorBoundaryState {
  error: Error | null;
}

export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  override state: ModuleErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ModuleErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local-first diagnostics only; nothing leaves the process.
    console.error("Module crashed:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <section
          role="alert"
          data-testid="module-error"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-4)",
            color: "var(--fg-0)",
            textAlign: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>
            This module hit an error.
          </h2>
          <p
            data-testid="module-error-message"
            style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}
          >
            {this.state.error.message}
          </p>
          <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
            Switch to another module and back to retry.
          </p>
        </section>
      );
    }
    return this.props.children;
  }
}
