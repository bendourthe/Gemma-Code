/**
 * v2.4.8 Phase 2 (T005) -- close a transient surface when the user acts
 * elsewhere.
 *
 * The composer overflow menu, the mic menu, and the Persona popover each
 * toggled with `useState` and closed only from their own button, so an open
 * menu outlived the interaction that opened it (operator screenshot 2,
 * 2026-09-06). This hook listens for a `pointerdown` anywhere in the document
 * and for Escape while `open` is true, and calls `onClose` unless the pointer
 * landed inside one of the given elements. Pass every element that belongs to
 * the surface (the menu and its toggle button), since a click on the toggle
 * must keep toggling rather than close-then-reopen.
 *
 * Listeners attach only while open and detach on close or unmount.
 */
import { useEffect, type RefObject } from "react";

export type DismissRef = RefObject<HTMLElement | null>;

export function useDismissOnOutside(
  refs: readonly DismissRef[],
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent | MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      for (const ref of refs) {
        if (ref.current?.contains(target)) return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    // jsdom and some pointer-less inputs deliver mousedown only.
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [refs, open, onClose]);
}
