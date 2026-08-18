/**
 * v1.18.0 Phase 4 -- in-memory ask-inbox client for tests and Storybook.
 */

import type { AskInboxClient, ParkedAskDto, ScheduledRunDto } from "./askInboxTypes";

export function createMockAskInboxClient(
  asks: ParkedAskDto[] = [],
  schedules: ScheduledRunDto[] = [
    {
      id: "morning-brief",
      name: "Morning brief",
      enabled: false,
      kind: "daily",
      hour: 8,
      minute: 0,
      promptSource: "hub:agent-presets/morning-briefing",
    },
  ],
): AskInboxClient {
  const items = [...asks];
  const sched = [...schedules];
  return {
    async list(state) {
      return state ? items.filter((a) => a.state === state) : items;
    },
    async approve(id) {
      const found = items.find((a) => a.id === id);
      if (!found || found.state !== "pending") return { ok: false, reason: "not pending" };
      (found as { state: string }).state = "approved";
      return { ok: true, reason: "approved" };
    },
    async deny(id) {
      const found = items.find((a) => a.id === id);
      if (!found || found.state !== "pending") return { ok: false, reason: "not pending" };
      (found as { state: string }).state = "denied";
      return { ok: true, reason: "denied" };
    },
    async pendingCount() {
      return items.filter((a) => a.state === "pending").length;
    },
    async listSchedules() {
      return sched;
    },
    async setScheduleEnabled(id, enabled) {
      const found = sched.find((s) => s.id === id);
      if (!found) return { ok: false };
      (found as { enabled: boolean }).enabled = enabled;
      return { ok: true };
    },
  };
}
