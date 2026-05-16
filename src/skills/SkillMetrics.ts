import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Tracer } from "../observability/Tracer.js";
import { getLogger } from "../utils/logger.js";

/**
 * v0.8.0 Phase 5 sub-task 5.1 (item D5) -- per-skill success metrics.
 *
 * Records every skill invocation as a discrete event and projects a rolling
 * 30-day window per skill. Events are persisted to `~/.gemma-code/metrics.json`
 * as a flat JSON document; the file is tiny (one record per invocation, the
 * window prunes anything older than 30 days on every write).
 *
 * Each invocation also emits one Tracer event of the form
 * `skill.<name>.<outcome>` so the same data shows up in the existing trace
 * dashboard / OTLP exporter when tracing is enabled.
 *
 * The module is intentionally tracer-aware via construction, not via a global,
 * so unit tests can fan out independent recorders without touching disk: the
 * `metricsPath` is injectable.
 */

export type SkillOutcome = "success" | "failure" | "retry" | "user-corrected";

export const SKILL_OUTCOMES: readonly SkillOutcome[] = [
  "success",
  "failure",
  "retry",
  "user-corrected",
];

const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface SkillInvocationEvent {
  readonly skill: string;
  readonly outcome: SkillOutcome;
  readonly durationMs: number;
  readonly timestamp: number;
}

export interface SkillStats {
  readonly skill: string;
  readonly invocations: number;
  readonly success: number;
  readonly failure: number;
  readonly retry: number;
  readonly userCorrected: number;
  readonly successRate: number;
  readonly avgDurationMs: number;
  readonly lastInvokedAt: number | null;
}

interface MetricsFileV1 {
  readonly version: 1;
  readonly events: readonly SkillInvocationEvent[];
}

function defaultMetricsPath(): string {
  return path.join(os.homedir(), ".gemma-code", "metrics.json");
}

export class SkillMetrics {
  private _events: SkillInvocationEvent[] = [];
  private _loaded = false;

  constructor(
    private readonly _metricsPath: string = defaultMetricsPath(),
    private readonly _tracer: Tracer | null = null,
    private readonly _now: () => number = Date.now,
  ) {}

  /** Absolute path the recorder writes to. Exposed for tests + the slash command. */
  get metricsPath(): string {
    return this._metricsPath;
  }

  recordInvocation(skill: string, outcome: SkillOutcome, durationMs: number): void {
    if (!SKILL_OUTCOMES.includes(outcome)) {
      throw new Error(`SkillMetrics: unknown outcome ${outcome}`);
    }
    this._ensureLoaded();
    const event: SkillInvocationEvent = {
      skill,
      outcome,
      durationMs: Math.max(0, Math.floor(durationMs)),
      timestamp: this._now(),
    };
    this._events.push(event);
    this._pruneOld();
    this._persist();
    this._emitTraceEvent(event);
  }

  getMetrics(skill?: string): SkillStats[] {
    this._ensureLoaded();
    this._pruneOld();
    const grouped = new Map<string, SkillInvocationEvent[]>();
    for (const ev of this._events) {
      if (skill && ev.skill !== skill) continue;
      const list = grouped.get(ev.skill);
      if (list) list.push(ev);
      else grouped.set(ev.skill, [ev]);
    }
    const out: SkillStats[] = [];
    for (const [name, events] of grouped) {
      let success = 0,
        failure = 0,
        retry = 0,
        userCorrected = 0,
        totalDuration = 0,
        last = 0;
      for (const ev of events) {
        if (ev.outcome === "success") success++;
        else if (ev.outcome === "failure") failure++;
        else if (ev.outcome === "retry") retry++;
        else if (ev.outcome === "user-corrected") userCorrected++;
        totalDuration += ev.durationMs;
        if (ev.timestamp > last) last = ev.timestamp;
      }
      const invocations = events.length;
      const successRate = invocations === 0 ? 0 : success / invocations;
      const avgDurationMs = invocations === 0 ? 0 : Math.round(totalDuration / invocations);
      out.push({
        skill: name,
        invocations,
        success,
        failure,
        retry,
        userCorrected,
        successRate,
        avgDurationMs,
        lastInvokedAt: last || null,
      });
    }
    out.sort((a, b) => b.invocations - a.invocations || a.skill.localeCompare(b.skill));
    return out;
  }

  /** Reset in-memory cache. Used by tests; production callers do not need this. */
  reset(): void {
    this._events = [];
    this._loaded = true;
  }

  private _ensureLoaded(): void {
    if (this._loaded) return;
    this._loaded = true;
    if (!fs.existsSync(this._metricsPath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this._metricsPath, "utf8");
      const parsed = JSON.parse(raw) as MetricsFileV1;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.events)) {
        this._events = parsed.events
          .filter((ev): ev is SkillInvocationEvent => isValidEvent(ev))
          .map((ev) => ({ ...ev }));
      }
    } catch (err) {
      getLogger().warn(`[SkillMetrics] failed to read ${this._metricsPath}; resetting`, err);
      this._events = [];
    }
  }

  private _pruneOld(): void {
    const cutoff = this._now() - ROLLING_WINDOW_MS;
    if (this._events.length === 0) return;
    if (this._events[0]!.timestamp >= cutoff) {
      // Cheap fast-path: the oldest event is still in the window. The list is
      // only weakly sorted (events arrive monotonically), so this catches the
      // common "metrics file is fresh" path.
      return;
    }
    this._events = this._events.filter((ev) => ev.timestamp >= cutoff);
  }

  private _persist(): void {
    try {
      fs.mkdirSync(path.dirname(this._metricsPath), { recursive: true });
      const payload: MetricsFileV1 = { version: 1, events: this._events };
      fs.writeFileSync(this._metricsPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      getLogger().warn(`[SkillMetrics] failed to persist ${this._metricsPath}`, err);
    }
  }

  private _emitTraceEvent(event: SkillInvocationEvent): void {
    if (!this._tracer || !this._tracer.enabled) return;
    const traceId = this._tracer.startTrace();
    if (!traceId) return;
    const spanId = this._tracer.startSpan(
      traceId,
      `skill.${event.skill}.${event.outcome}`,
      "custom",
      undefined,
      {
        skill: event.skill,
        outcome: event.outcome,
        durationMs: event.durationMs,
      },
    );
    this._tracer.endSpan(spanId, event.outcome === "success" ? "ok" : "error", {
      durationMs: event.durationMs,
    });
  }
}

function isValidEvent(ev: unknown): ev is SkillInvocationEvent {
  if (typeof ev !== "object" || ev === null) return false;
  const o = ev as Record<string, unknown>;
  return (
    typeof o["skill"] === "string" &&
    typeof o["outcome"] === "string" &&
    SKILL_OUTCOMES.includes(o["outcome"] as SkillOutcome) &&
    typeof o["durationMs"] === "number" &&
    typeof o["timestamp"] === "number"
  );
}

export function formatMetricsTable(stats: readonly SkillStats[]): string {
  if (stats.length === 0) {
    return "_No skill invocations recorded in the past 30 days._";
  }
  const lines: string[] = [];
  lines.push("## Skill Metrics (rolling 30-day window)");
  lines.push("");
  lines.push("| Skill | Invocations | Success | Failure | Retry | User-corrected | Success rate | Avg duration |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const s of stats) {
    const successRatePct = (s.successRate * 100).toFixed(1) + "%";
    const avgMs = s.avgDurationMs.toFixed(0) + " ms";
    lines.push(
      `| \`${s.skill}\` | ${s.invocations} | ${s.success} | ${s.failure} | ${s.retry} | ${s.userCorrected} | ${successRatePct} | ${avgMs} |`,
    );
  }
  return lines.join("\n");
}
