/**
 * v1.18.0 Phase 4 (OW-A1) -- ask-inbox client contract (injectable for tests).
 */

export interface ParkedAskDto {
  readonly id: string;
  readonly state: "pending" | "approved" | "denied" | "expired";
  readonly runMode: "headless" | "scheduled";
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly decidedAt?: number;
  readonly decisionReason?: string;
  readonly toolName: string;
  readonly summary: string;
  readonly detail: string;
  readonly args: Record<string, unknown>;
  readonly risk: string;
  readonly classificationReason: string;
  readonly parkedTier: number;
  readonly sessionId?: string;
  readonly runId: string;
}

export interface ScheduledRunDto {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly kind: "daily" | "interval";
  readonly hour?: number;
  readonly minute?: number;
  readonly promptSource?: string;
}

export interface AskInboxClient {
  list(state?: ParkedAskDto["state"]): Promise<readonly ParkedAskDto[]>;
  approve(id: string): Promise<{ ok: boolean; reason: string }>;
  deny(id: string): Promise<{ ok: boolean; reason: string }>;
  pendingCount(): Promise<number>;
  listSchedules(): Promise<readonly ScheduledRunDto[]>;
  setScheduleEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }>;
}
