/**
 * v2.1.0 Phase 6 -- append-only locally signed SQLite audit log.
 *
 * Local-only. Secrets pass redactSecrets before persist. Burst writes that
 * exceed `maxPending` increment droppedCount instead of blocking forever.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import BetterSqlite from "better-sqlite3";
import type Database from "better-sqlite3";
import { redactSecrets } from "../observability/redactSecrets.js";
import { nexusHome } from "../storage/paths.js";
import type { TelemetryBus, TelemetryEvent } from "../telemetry/TelemetryBus.js";
import {
  type ActorKeyStore,
  type AuditActor,
  ensureActorKeys,
  MemoryActorKeyStore,
  signPayload,
  verifyPayload,
} from "./signing.js";

export interface AuditEvent {
  readonly id: number;
  readonly ts: string;
  readonly actor: AuditActor;
  readonly pillar: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly signature: string;
  readonly trusted: boolean;
}

export interface AuditAppendInput {
  readonly actor: AuditActor;
  readonly pillar: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly ts?: string;
}

export interface AuditQuery {
  readonly actor?: AuditActor;
  readonly pillar?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    pillar TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    signature TEXT NOT NULL,
    public_pem TEXT NOT NULL
  )`,
];

function canonical(input: {
  ts: string;
  actor: string;
  pillar: string;
  kind: string;
  payload: Record<string, unknown>;
}): string {
  return JSON.stringify({
    ts: input.ts,
    actor: input.actor,
    pillar: input.pillar,
    kind: input.kind,
    payload: input.payload,
  });
}

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return redactSecrets(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  return walk(payload) as Record<string, unknown>;
}

export class AuditLog {
  private readonly db: Database.Database;
  private readonly keys: ActorKeyStore;
  private readonly maxPending: number;
  private pending = 0;
  private dropped = 0;
  private closed = false;
  private ready: Promise<void>;

  constructor(opts: {
    readonly dbPath?: string;
    readonly keys?: ActorKeyStore;
    readonly maxPending?: number;
    readonly homeDirFn?: () => string;
  } = {}) {
    const dbPath =
      opts.dbPath ?? path.join(nexusHome(opts.homeDirFn), "audit", "audit.db");
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new BetterSqlite(dbPath);
    this.db.pragma("journal_mode = WAL");
    for (const sql of SCHEMA) this.db.exec(sql);
    this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', '1')").run();
    const storedDropped = this.db.prepare("SELECT value FROM meta WHERE key = 'dropped'").get() as
      | { value: string }
      | undefined;
    this.dropped = storedDropped ? Number(storedDropped.value) || 0 : 0;
    this.keys = opts.keys ?? new MemoryActorKeyStore();
    this.maxPending = opts.maxPending ?? 64;
    this.ready = ensureActorKeys(this.keys).then(() => undefined);
  }

  async append(input: AuditAppendInput): Promise<AuditEvent | null> {
    if (this.pending >= this.maxPending) {
      this.dropped += 1;
      this.db
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('dropped', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(String(this.dropped));
      return null;
    }
    this.pending += 1;
    try {
      await this.ready;
      const pair = await this.keys.get(input.actor);
      if (!pair) throw new Error(`missing key for ${input.actor}`);
      const ts = input.ts ?? new Date().toISOString();
      const payload = redactPayload(input.payload);
      const body = canonical({ ts, actor: input.actor, pillar: input.pillar, kind: input.kind, payload });
      const signature = signPayload(pair.privatePem, body);
      const info = this.db
        .prepare(
          `INSERT INTO events (ts, actor, pillar, kind, payload_json, signature, public_pem)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ts, input.actor, input.pillar, input.kind, JSON.stringify(payload), signature, pair.publicPem);
      return {
        id: Number(info.lastInsertRowid),
        ts,
        actor: input.actor,
        pillar: input.pillar,
        kind: input.kind,
        payload,
        signature,
        trusted: true,
      };
    } finally {
      this.pending -= 1;
    }
  }

  list(query: AuditQuery = {}): AuditEvent[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.actor) {
      clauses.push("actor = ?");
      params.push(query.actor);
    }
    if (query.pillar) {
      clauses.push("pillar = ?");
      params.push(query.pillar);
    }
    if (query.since) {
      clauses.push("ts >= ?");
      params.push(query.since);
    }
    if (query.until) {
      clauses.push("ts <= ?");
      params.push(query.until);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const rows = this.db
      .prepare(
        `SELECT id, ts, actor, pillar, kind, payload_json, signature, public_pem
         FROM events ${where} ORDER BY id ASC LIMIT ?`,
      )
      .all(...params, limit) as Array<{
      id: number;
      ts: string;
      actor: AuditActor;
      pillar: string;
      kind: string;
      payload_json: string;
      signature: string;
      public_pem: string;
    }>;
    return rows.map((row) => {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const body = canonical({
        ts: row.ts,
        actor: row.actor,
        pillar: row.pillar,
        kind: row.kind,
        payload,
      });
      return {
        id: row.id,
        ts: row.ts,
        actor: row.actor,
        pillar: row.pillar,
        kind: row.kind,
        payload,
        signature: row.signature,
        trusted: verifyPayload(row.public_pem, body, row.signature),
      };
    });
  }

  droppedCount(): number {
    return this.dropped;
  }

  eventCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    return Number(row.n) || 0;
  }

  attach(bus: TelemetryBus): { dispose(): void } {
    return bus.subscribe({}, (event) => {
      void this.append(mapTelemetry(event));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch {
      /* best-effort */
    }
  }
}

export function mapTelemetry(event: TelemetryEvent): AuditAppendInput {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const role = typeof payload.role === "string" ? payload.role : "";
  const actor: AuditActor =
    role === "planner" || role === "critic" || role === "worker" ? role : "app";
  const pillar =
    event.source === "gpu-scheduler"
      ? typeof payload.moduleId === "string"
        ? payload.moduleId
        : "scheduler"
      : event.source;
  return {
    actor,
    pillar,
    kind: event.kind,
    payload,
    ts: event.ts,
  };
}
