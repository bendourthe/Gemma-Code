/**
 * v1.18.0 Phase 4 (OW-A2) -- local cron-style scheduler for recurring agent
 * runs. Every wake is headless: GitSafetyNet-equivalent checkpoint, then a
 * parking confirm. There is no auto-approve path.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HeadlessConfirmFn } from "../runtime/headlessGuards.js";
import type { AskInbox } from "./AskInbox.js";
import { createScheduledGitCheckpoint, type ScheduledGitCheckpoint } from "./gitCheckpoint.js";
import { MORNING_BRIEF_FALLBACK_PROMPT, MORNING_BRIEF_PROMPT_SOURCE } from "./morningBrief.js";
import { assertNoAutoApprove, type AutoApproveFlags } from "./noAutoApprove.js";
import { createParkingConfirm } from "./parkingConfirm.js";
import { MORNING_BRIEF_SCHEDULE_ID } from "./types.js";
import { workspaceIdForRoots } from "../../../core/project/WorkspaceScope.js";

export type ScheduleKind = "daily" | "interval";

export interface ScheduledRunSpec {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly kind: ScheduleKind;
  readonly hour?: number;
  readonly minute?: number;
  readonly intervalMs?: number;
  readonly prompt: string;
  readonly promptSource?: string;
  readonly workspacePath?: string;
  readonly workspaceId?: string;
  readonly workspaceRoots?: readonly string[];
  readonly primaryRoot?: string;
}

export interface HeadlessScheduledRun {
  readonly prompt: string;
  readonly workspacePath: string;
  readonly workspaceId?: string;
  readonly workspaceRoots?: readonly string[];
  readonly primaryRoot?: string;
  readonly runId: string;
  readonly confirm: HeadlessConfirmFn;
  readonly checkpoint: ScheduledGitCheckpoint | null;
}

export interface AgentRunSchedulerOptions {
  readonly inbox: AskInbox;
  readonly workspacePath: string;
  readonly workspaceId?: string;
  readonly workspaceRoots?: readonly string[];
  readonly primaryRoot?: string;
  readonly now?: () => number;
  readonly setInterval?: (cb: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly tickIntervalMs?: number;
  readonly filePath?: string;
  readonly createCheckpoint?: (cwd: string) => Promise<ScheduledGitCheckpoint | null>;
  readonly runHeadless?: (run: HeadlessScheduledRun) => Promise<void>;
  readonly schedules?: readonly ScheduledRunSpec[];
}

interface ScheduleState extends Omit<ScheduledRunSpec, "enabled"> {
  enabled: boolean;
  nextFireAt: number;
  lastRunAt?: number;
}

function nextDailyFire(now: number, hour: number, minute: number): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function builtinMorningBrief(workspacePath: string): ScheduledRunSpec {
  return {
    id: MORNING_BRIEF_SCHEDULE_ID,
    name: "Morning brief",
    enabled: false,
    kind: "daily",
    hour: 8,
    minute: 0,
    prompt: MORNING_BRIEF_FALLBACK_PROMPT,
    promptSource: MORNING_BRIEF_PROMPT_SOURCE,
    workspacePath,
  };
}

export function createScheduledRun(
  spec: ScheduledRunSpec & AutoApproveFlags,
): ScheduledRunSpec {
  assertNoAutoApprove(spec);
  return {
    id: spec.id,
    name: spec.name,
    enabled: spec.enabled,
    kind: spec.kind,
    hour: spec.hour,
    minute: spec.minute,
    intervalMs: spec.intervalMs,
    prompt: spec.prompt,
    promptSource: spec.promptSource,
    workspacePath: spec.workspacePath,
    workspaceId: spec.workspaceId,
    workspaceRoots: spec.workspaceRoots ? Object.freeze([...spec.workspaceRoots]) : undefined,
    primaryRoot: spec.primaryRoot,
  };
}

const DEFAULT_TICK_MS = 30_000;

export class AgentRunScheduler {
  private readonly _inbox: AskInbox;
  private readonly _workspacePath: string;
  private readonly _workspaceId: string;
  private readonly _workspaceRoots: readonly string[];
  private readonly _primaryRoot: string;
  private readonly _now: () => number;
  private readonly _setInterval: (cb: () => void, ms: number) => unknown;
  private readonly _clearInterval: (handle: unknown) => void;
  private readonly _tickIntervalMs: number;
  private readonly _filePath?: string;
  private readonly _createCheckpoint: (cwd: string) => Promise<ScheduledGitCheckpoint | null>;
  private readonly _runHeadless: (run: HeadlessScheduledRun) => Promise<void>;
  private _schedules: ScheduleState[] = [];
  private _tickHandle: unknown = null;
  private _firing = false;

  constructor(opts: AgentRunSchedulerOptions) {
    this._inbox = opts.inbox;
    this._workspacePath = opts.workspacePath;
    this._workspaceRoots = Object.freeze([...(opts.workspaceRoots?.length ? opts.workspaceRoots : [opts.workspacePath])]);
    this._primaryRoot = opts.primaryRoot ?? opts.workspacePath;
    this._workspaceId = opts.workspaceId ?? workspaceIdForRoots(this._workspaceRoots);
    this._now = opts.now ?? Date.now;
    this._setInterval = opts.setInterval ?? ((cb, ms) => setInterval(cb, ms));
    this._clearInterval =
      opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this._tickIntervalMs = opts.tickIntervalMs ?? DEFAULT_TICK_MS;
    this._filePath = opts.filePath;
    this._createCheckpoint = opts.createCheckpoint ?? createScheduledGitCheckpoint;
    this._runHeadless = opts.runHeadless ?? (async () => undefined);
    const specs = opts.schedules ?? [builtinMorningBrief(opts.workspacePath)];
    const now = this._now();
    this._schedules = specs.map((spec) => this.toState(createScheduledRun(spec), now));
  }

  private toState(spec: ScheduledRunSpec, now: number): ScheduleState {
    const nextFireAt =
      spec.kind === "interval"
        ? now + (spec.intervalMs ?? 60_000)
        : nextDailyFire(now, spec.hour ?? 8, spec.minute ?? 0);
    return { ...spec, nextFireAt };
  }

  private toPublic(schedule: ScheduleState): ScheduledRunSpec {
    return {
      id: schedule.id,
      name: schedule.name,
      enabled: schedule.enabled,
      kind: schedule.kind,
      hour: schedule.hour,
      minute: schedule.minute,
      intervalMs: schedule.intervalMs,
      prompt: schedule.prompt,
      promptSource: schedule.promptSource,
      workspacePath: schedule.workspacePath,
      workspaceId: schedule.workspaceId,
      workspaceRoots: schedule.workspaceRoots ? [...schedule.workspaceRoots] : undefined,
      primaryRoot: schedule.primaryRoot,
    };
  }

  list(): readonly ScheduledRunSpec[] {
    return this._schedules.map((schedule) => this.toPublic(schedule));
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledRunSpec | undefined> {
    const found = this._schedules.find((s) => s.id === id);
    if (!found) return undefined;
    found.enabled = enabled;
    if (enabled) found.nextFireAt = this.toState(found, this._now()).nextFireAt;
    await this.persist();
    return this.toPublic(found);
  }

  start(): void {
    if (this._tickHandle !== null) return;
    this._tickHandle = this._setInterval(() => {
      void this.tick();
    }, this._tickIntervalMs);
  }

  stop(): void {
    if (this._tickHandle === null) return;
    this._clearInterval(this._tickHandle);
    this._tickHandle = null;
  }

  async tick(): Promise<void> {
    if (this._firing) return;
    const now = this._now();
    for (const schedule of this._schedules) {
      if (!schedule.enabled || schedule.nextFireAt > now) continue;
      this._firing = true;
      try {
        await this.fire(schedule);
      } finally {
        this._firing = false;
        schedule.lastRunAt = this._now();
        schedule.nextFireAt =
          schedule.kind === "interval"
            ? this._now() + (schedule.intervalMs ?? 60_000)
            : nextDailyFire(this._now(), schedule.hour ?? 8, schedule.minute ?? 0);
        await this.persist();
      }
    }
  }

  async fireNow(id: string): Promise<void> {
    const schedule = this._schedules.find((s) => s.id === id);
    if (!schedule) throw new Error(`Unknown schedule: ${id}`);
    await this.fire(schedule);
  }

  private async fire(schedule: ScheduleState): Promise<void> {
    assertNoAutoApprove();
    const workspacePath = schedule.workspacePath ?? this._workspacePath;
    const workspaceRoots = Object.freeze([
      ...(schedule.workspaceRoots?.length ? schedule.workspaceRoots : this._workspaceRoots),
    ]);
    const primaryRoot = schedule.primaryRoot ?? workspacePath ?? this._primaryRoot;
    const workspaceId = schedule.workspaceId ?? this._workspaceId;
    const runId = `${schedule.id}:${this._now()}`;
    const checkpoint = await this._createCheckpoint(workspacePath);
    const confirm = createParkingConfirm({
      inbox: this._inbox,
      runMode: "scheduled",
      runId,
    });
    await this._runHeadless({
      prompt: schedule.prompt,
      workspacePath,
      workspaceId,
      workspaceRoots,
      primaryRoot,
      runId,
      confirm,
      checkpoint,
    });
  }

  private async persist(): Promise<void> {
    if (!this._filePath) return;
    await mkdir(dirname(this._filePath), { recursive: true });
    const body = JSON.stringify(
      {
        version: 1,
        schedules: this._schedules.map(({ nextFireAt, lastRunAt, ...spec }) => ({
          ...spec,
          nextFireAt,
          lastRunAt,
        })),
      },
      null,
      2,
    );
    await writeFile(this._filePath, `${body}\n`, "utf8");
  }

  static async loadFromFile(
    filePath: string,
    opts: Omit<AgentRunSchedulerOptions, "schedules" | "filePath">,
  ): Promise<AgentRunScheduler> {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { schedules?: ScheduledRunSpec[] };
      const schedules = Array.isArray(parsed.schedules) ? parsed.schedules : undefined;
      return new AgentRunScheduler({ ...opts, filePath, schedules });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      return new AgentRunScheduler({ ...opts, filePath });
    }
  }
}
