/**
 * Frameless custom dark title bar for the Nexus AI Studio shell (v1.9.0 T501).
 *
 * Replaces the native OS title bar (`decorations: false` in tauri.conf.json).
 * It carries the transparent brand mark + "Nexus AI Studio" wordmark and the
 * window controls (minimize / maximize-restore / close). The draggable region
 * uses Tauri's native `data-tauri-drag-region` (move + double-click-maximize);
 * the explicit buttons call the window API through the safe `windowControls`
 * wrapper, which no-ops outside a Tauri runtime.
 *
 * The mark is deliberately static (a small cyan glow, no bob): title-bar chrome
 * never draws attention with motion. The animated floating hero mark lives on
 * the Dashboard, matching the installer's two-mark brand treatment.
 */

import { useCallback, useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { getWindowControls, type WindowControls } from "../lib/windowControls";

export interface TitleBarProps {
  /** Brand wordmark shown next to the mark. */
  title?: string;
  /** Transparent brand mark; defaults to the public squircle mark. */
  markSrc?: string;
  /** Window controls; defaults to the Tauri-backed (or no-op) wrapper. */
  controls?: WindowControls;
}

export function TitleBar({
  title = "Nexus AI Studio",
  markSrc = "/nexus-mark.png",
  controls = getWindowControls(),
}: TitleBarProps = {}): JSX.Element {
  const [maximized, setMaximized] = useState(false);

  // Sync the maximize/restore glyph with the real window state on mount so an
  // OS-initiated maximize (Aero snap, double-click) shows the correct glyph.
  useEffect(() => {
    let cancelled = false;
    void controls.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value);
    });
    return () => {
      cancelled = true;
    };
  }, [controls]);

  const onMinimize = useCallback(() => {
    void controls.minimize();
  }, [controls]);

  const onToggleMaximize = useCallback(() => {
    void controls.toggleMaximize().then(() => controls.isMaximized()).then(setMaximized);
  }, [controls]);

  const onClose = useCallback(() => {
    void controls.close();
  }, [controls]);

  return (
    <div data-testid="title-bar" className="nexus-titlebar">
      <div className="nexus-titlebar-brand" data-tauri-drag-region>
        <img
          src={markSrc}
          alt=""
          aria-hidden
          width={20}
          height={20}
          className="nexus-titlebar-mark"
          data-testid="title-bar-mark"
        />
        <span className="nexus-titlebar-title" data-testid="title-bar-title">
          {title}
        </span>
      </div>

      <div className="nexus-titlebar-controls">
        <button
          type="button"
          aria-label="Minimize"
          data-testid="title-bar-minimize"
          className="nexus-titlebar-btn"
          onClick={onMinimize}
        >
          <Minus size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          data-testid="title-bar-maximize"
          className="nexus-titlebar-btn"
          onClick={onToggleMaximize}
        >
          {maximized ? <Copy size={14} aria-hidden /> : <Square size={14} aria-hidden />}
        </button>
        <button
          type="button"
          aria-label="Close"
          data-testid="title-bar-close"
          className="nexus-titlebar-btn nexus-titlebar-btn-close"
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
