import { useEffect, useState } from "react";

import type { AskInboxClient } from "./askInboxTypes";

const POLL_MS = 4000;

export function useAskInboxPendingCount(client?: AskInboxClient, pollMs = POLL_MS): number {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!client) return;
    const source = client;
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const count = await source.pendingCount();
        if (!cancelled) setPending(count);
      } catch {
        if (!cancelled) setPending(0);
      }
    }
    void poll();
    const handle = setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [client, pollMs]);

  return pending;
}
