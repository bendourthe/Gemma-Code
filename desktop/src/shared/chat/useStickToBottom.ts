/**
 * v2.4.2 Phase 2 -- keep the latest turn in view unless the user scrolled up.
 *
 * Composer send always jumps to the bottom. Incoming tokens only follow when
 * the viewport is already pinned there. An empty list is a no-op.
 */

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

const BOTTOM_SLACK_PX = 48;

function isPinnedToBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_SLACK_PX;
}

export function useStickToBottom(followKey: unknown): {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  stickNow: () => void;
} {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  const apply = useCallback((): void => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = isPinnedToBottom(el);
  }, []);

  const stickNow = useCallback((): void => {
    pinnedRef.current = true;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    apply();
  }, [apply, followKey]);

  return { scrollRef, onScroll, stickNow };
}
