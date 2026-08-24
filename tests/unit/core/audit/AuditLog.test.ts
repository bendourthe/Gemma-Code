import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { AuditLog, mapTelemetry } from "../../../../core/audit/index.js";
import { MemoryActorKeyStore, generateActorKey } from "../../../../core/audit/signing.js";
import { InProcessTelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";
import { REDACTED } from "../../../../core/observability/redactSecrets.js";

const logs: AuditLog[] = [];

function openLog(opts: ConstructorParameters<typeof AuditLog>[0] = {}): AuditLog {
  const log = new AuditLog(opts);
  logs.push(log);
  return log;
}

afterEach(() => {
  while (logs.length > 0) logs.pop()?.close();
});

describe("AuditLog", () => {
  it("round-trips a signature and attributes planner vs worker from telemetry", async () => {
    const log = openLog({ dbPath: ":memory:" });
    const bus = new InProcessTelemetryBus();
    log.attach(bus);
    bus.publish({
      kind: "routing.decision",
      source: "coding",
      payload: { role: "planner", reason: "escalate" },
    });
    bus.publish({
      kind: "chat.turn",
      source: "coding",
      payload: { role: "worker", sessionId: "s1" },
    });
    bus.publish({
      kind: "job.started",
      source: "image",
      payload: { jobId: "g1" },
    });
    await new Promise((r) => setTimeout(r, 20));
    const events = log.list();
    expect(events.every((e) => e.trusted)).toBe(true);
    expect(events.map((e) => e.actor).sort()).toEqual(["app", "planner", "worker"]);
  });

  it("redacts secrets before persist", async () => {
    const log = openLog({ dbPath: ":memory:" });
    await log.append({
      actor: "app",
      pillar: "coding",
      kind: "chat.turn",
      payload: { token: "AKIAIOSFODNN7EXAMPLE" },
    });
    const row = log.list()[0];
    expect(row?.payload.token).toBe(REDACTED);
    expect(row?.trusted).toBe(true);
  });

  it("marks a tampered row untrusted instead of hiding it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nexus-audit-"));
    const dbPath = join(dir, "audit.db");
    try {
      const log = openLog({ dbPath });
      await log.append({
        actor: "app",
        pillar: "coding",
        kind: "chat.turn",
        payload: { ok: true },
      });
      const raw = new BetterSqlite(dbPath);
      raw.prepare("UPDATE events SET payload_json = ?").run(JSON.stringify({ hacked: true }));
      raw.close();
      const listed = log.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.payload).toEqual({ hacked: true });
      expect(listed[0]?.trusted).toBe(false);
      log.close();
      logs.pop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts dropped events when the pending buffer is full", async () => {
    const log = openLog({ dbPath: ":memory:", maxPending: 0 });
    const dropped = await log.append({
      actor: "app",
      pillar: "coding",
      kind: "chat.turn",
      payload: { n: 1 },
    });
    expect(dropped).toBeNull();
    expect(log.droppedCount()).toBe(1);
    expect(log.list()).toHaveLength(0);
  });

  it("drops a burst that exceeds maxPending", async () => {
    const keys = new MemoryActorKeyStore();
    await keys.set(generateActorKey("app"));
    const log = openLog({ dbPath: ":memory:", keys, maxPending: 1 });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        log.append({ actor: "app", pillar: "coding", kind: "chat.turn", payload: { i } }),
      ),
    );
    const kept = results.filter((r) => r !== null);
    const missed = results.filter((r) => r === null);
    expect(kept.length + missed.length).toBe(12);
    expect(missed.length + log.droppedCount()).toBeGreaterThanOrEqual(1);
    expect(log.droppedCount()).toBe(missed.length);
  });

  it("filters list queries and reports eventCount", async () => {
    const log = openLog({ dbPath: ":memory:" });
    await log.append({
      actor: "planner",
      pillar: "coding",
      kind: "routing.decision",
      payload: { n: 1 },
      ts: "2026-08-20T10:00:00.000Z",
    });
    await log.append({
      actor: "app",
      pillar: "image",
      kind: "job.started",
      payload: { n: 2 },
      ts: "2026-08-20T11:00:00.000Z",
    });
    expect(log.eventCount()).toBe(2);
    expect(log.list({ actor: "planner" })).toHaveLength(1);
    expect(log.list({ pillar: "image" })).toHaveLength(1);
    expect(log.list({ since: "2026-08-20T10:30:00.000Z" })).toHaveLength(1);
    expect(log.list({ until: "2026-08-20T10:30:00.000Z" })).toHaveLength(1);
  });

  it("maps gpu-scheduler moduleId and critic role", () => {
    const training = mapTelemetry({
      kind: "job.started",
      source: "gpu-scheduler",
      ts: "2026-08-20T12:00:00.000Z",
      payload: { moduleId: "tuning", role: "critic" },
    });
    expect(training.actor).toBe("critic");
    expect(training.pillar).toBe("tuning");
    const untitled = mapTelemetry({
      kind: "job.queued",
      source: "gpu-scheduler",
      ts: "2026-08-20T12:00:00.000Z",
      payload: {},
    });
    expect(untitled.pillar).toBe("scheduler");
    expect(untitled.actor).toBe("app");
  });
});
