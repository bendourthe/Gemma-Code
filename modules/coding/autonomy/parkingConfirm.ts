/**
 * v1.18.0 Phase 4 (OW-A1) -- HeadlessConfirmFn that parks instead of
 * fail-closing or waiting 60s. The live tool path stays suspended until
 * AskInbox.approve/deny/expiry resolves the waiter.
 */

import type { HeadlessConfirmFn } from "../runtime/headlessGuards.js";
import type { AskInbox } from "./AskInbox.js";
import { assertNoAutoApprove } from "./noAutoApprove.js";

export interface ParkingConfirmOptions {
  readonly inbox: AskInbox;
  readonly runMode: "headless" | "scheduled";
  readonly runId: string;
  readonly sessionId?: string;
  readonly ttlMs?: number;
}

export function createParkingConfirm(opts: ParkingConfirmOptions): HeadlessConfirmFn {
  assertNoAutoApprove();
  return async (toolName, summary, detail, args) => {
    const outcome = await opts.inbox.parkAndWait({
      toolName,
      summary,
      detail,
      args: args ?? {},
      runMode: opts.runMode,
      runId: opts.runId,
      sessionId: opts.sessionId,
      ttlMs: opts.ttlMs,
    });
    return outcome === "approved";
  };
}
