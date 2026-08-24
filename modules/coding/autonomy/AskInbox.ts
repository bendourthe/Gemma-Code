/**
 * v1.18.0 Phase 4 (OW-A1) -- persistent local approval queue.
 *
 * Headless and scheduled CONFIRM/DANGEROUS asks park here instead of the 60s
 * ConfirmationGate timeout or an auto-approve. Interactive sessions never
 * construct this path. Approve replays through classifyAction + resolveTier;
 * a missing waiter fails safe (the tool is not re-executed).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { classifyAction } from "../guardrails/ActionClassifier.js";
import { resolveTier } from "../runtime/headlessGuards.js";
import { replayAsk, type ReplayAskOptions } from "./replayAsk.js";
import {
  DEFAULT_ASK_TTL_MS,
  type ApproveResult,
  type AskState,
  type ParkAskInput,
  type ParkedAsk,
} from "./types.js";

export interface AskInboxStore {
  load(): Promise<ParkedAsk[]>;
  save(items: readonly ParkedAsk[]): Promise<void>;
}

export class MemoryAskInboxStore implements AskInboxStore {
  private items: ParkedAsk[] = [];

  async load(): Promise<ParkedAsk[]> {
    return this.items.map((item) => ({ ...item, args: { ...item.args } }));
  }

  async save(items: readonly ParkedAsk[]): Promise<void> {
    this.items = items.map((item) => ({ ...item, args: { ...item.args } }));
  }
}

export class JsonFileAskInboxStore implements AskInboxStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ParkedAsk[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { items?: ParkedAsk[] };
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw err;
    }
  }

  async save(items: readonly ParkedAsk[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    const body = `${JSON.stringify({ version: 1, items }, null, 2)}\n`;
    await writeFile(tmp, body, "utf8");
    try {
      await rename(tmp, this.filePath);
    } catch {
      try {
        await unlink(this.filePath);
      } catch {
        // dest may not exist
      }
      await rename(tmp, this.filePath);
    }
  }
}

export interface AskInboxOptions {
  readonly store?: AskInboxStore;
  readonly filePath?: string;
  readonly now?: () => number;
  readonly idFactory?: () => string;
  readonly ttlMs?: number;
  readonly replay?: ReplayAskOptions;
}

type Waiter = (state: Extract<AskState, "approved" | "denied" | "expired">) => void;

export class AskInbox {
  private readonly _store: AskInboxStore;
  private readonly _now: () => number;
  private readonly _idFactory: () => string;
  private readonly _ttlMs: number;
  private readonly _replay: ReplayAskOptions;
  private _items: ParkedAsk[] = [];
  private _loaded = false;
  private readonly _waiters = new Map<string, Waiter>();

  constructor(opts: AskInboxOptions = {}) {
    this._store =
      opts.store ??
      (opts.filePath ? new JsonFileAskInboxStore(opts.filePath) : new MemoryAskInboxStore());
    this._now = opts.now ?? Date.now;
    this._idFactory = opts.idFactory ?? (() => randomUUID());
    this._ttlMs = opts.ttlMs ?? DEFAULT_ASK_TTL_MS;
    this._replay = opts.replay ?? {};
  }

  private async ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    this._items = await this._store.load();
    this._loaded = true;
    this.expireDue();
  }

  private expireDue(): ParkedAsk[] {
    const now = this._now();
    const expired: ParkedAsk[] = [];
    this._items = this._items.map((item) => {
      if (item.state !== "pending" || item.expiresAt > now) return item;
      const next: ParkedAsk = {
        ...item,
        state: "expired",
        decidedAt: now,
        decisionReason: "expired before approval",
      };
      expired.push(next);
      const waiter = this._waiters.get(item.id);
      if (waiter) {
        this._waiters.delete(item.id);
        waiter("expired");
      }
      return next;
    });
    return expired;
  }

  private async persist(): Promise<void> {
    await this._store.save(this._items);
  }

  async park(input: ParkAskInput): Promise<ParkedAsk> {
    await this.ensureLoaded();
    this.expireDue();
    const now = this._now();
    const args = { ...(input.args ?? {}) };
    const call = {
      id: "park",
      tool: input.toolName as never,
      parameters: args,
      source: "local-agent" as const,
    };
    const classification = classifyAction(call);
    const ask: ParkedAsk = {
      id: this._idFactory(),
      state: "pending",
      runMode: input.runMode,
      createdAt: now,
      expiresAt: now + (input.ttlMs ?? this._ttlMs),
      toolName: input.toolName,
      summary: input.summary,
      detail: input.detail ?? "",
      args,
      risk: classification.risk,
      classificationReason: classification.reason,
      parkedTier: resolveTier(input.toolName),
      sessionId: input.sessionId,
      runId: input.runId,
    };
    this._items.push(ask);
    await this.persist();
    return ask;
  }

  async waitForDecision(id: string): Promise<Extract<AskState, "approved" | "denied" | "expired">> {
    await this.ensureLoaded();
    this.expireDue();
    const existing = this._items.find((item) => item.id === id);
    if (!existing) return "denied";
    if (existing.state !== "pending") {
      return existing.state;
    }
    return new Promise((resolve) => {
      this._waiters.set(id, resolve);
    });
  }

  async parkAndWait(input: ParkAskInput): Promise<Extract<AskState, "approved" | "denied" | "expired">> {
    await this.ensureLoaded();
    this.expireDue();
    const now = this._now();
    const args = { ...(input.args ?? {}) };
    const call = {
      id: "park",
      tool: input.toolName as never,
      parameters: args,
      source: "local-agent" as const,
    };
    const classification = classifyAction(call);
    const ask: ParkedAsk = {
      id: this._idFactory(),
      state: "pending",
      runMode: input.runMode,
      createdAt: now,
      expiresAt: now + (input.ttlMs ?? this._ttlMs),
      toolName: input.toolName,
      summary: input.summary,
      detail: input.detail ?? "",
      args,
      risk: classification.risk,
      classificationReason: classification.reason,
      parkedTier: resolveTier(input.toolName),
      sessionId: input.sessionId,
      runId: input.runId,
    };
    const decision = new Promise<Extract<AskState, "approved" | "denied" | "expired">>((resolve) => {
      this._waiters.set(ask.id, resolve);
    });
    this._items.push(ask);
    await this.persist();
    return decision;
  }

  async approve(id: string): Promise<ApproveResult> {
    await this.ensureLoaded();
    this.expireDue();
    const index = this._items.findIndex((item) => item.id === id);
    const ask = index >= 0 ? this._items[index] : undefined;
    if (!ask || ask.state !== "pending") {
      return { ok: false, reason: "Ask is not pending.", executed: false };
    }
    const replay = replayAsk(ask, this._replay);
    const waiter = this._waiters.get(id);
    const now = this._now();
    if (!waiter) {
      this._items[index] = {
        ...ask,
        state: "denied",
        decidedAt: now,
        decisionReason: "session gone; fail-safe (no live waiter)",
      };
      await this.persist();
      return {
        ok: false,
        reason: "session gone; fail-safe (no live waiter)",
        replay,
        executed: false,
      };
    }
    if (!replay.allowed) {
      this._items[index] = {
        ...ask,
        state: "denied",
        decidedAt: now,
        decisionReason: replay.reason,
      };
      this._waiters.delete(id);
      waiter("denied");
      await this.persist();
      return { ok: false, reason: replay.reason, replay, executed: false };
    }
    this._items[index] = {
      ...ask,
      state: "approved",
      decidedAt: now,
      decisionReason: replay.reason,
    };
    this._waiters.delete(id);
    waiter("approved");
    await this.persist();
    return { ok: true, reason: replay.reason, replay, executed: false };
  }

  async deny(id: string, reason = "denied by user"): Promise<{ ok: boolean; reason: string }> {
    await this.ensureLoaded();
    this.expireDue();
    const index = this._items.findIndex((item) => item.id === id);
    const ask = index >= 0 ? this._items[index] : undefined;
    if (!ask || ask.state !== "pending") {
      return { ok: false, reason: "Ask is not pending." };
    }
    this._items[index] = {
      ...ask,
      state: "denied",
      decidedAt: this._now(),
      decisionReason: reason,
    };
    const waiter = this._waiters.get(id);
    if (waiter) {
      this._waiters.delete(id);
      waiter("denied");
    }
    await this.persist();
    return { ok: true, reason };
  }

  async sweepExpired(): Promise<number> {
    await this.ensureLoaded();
    const expired = this.expireDue();
    if (expired.length > 0) await this.persist();
    return expired.length;
  }

  async list(state?: AskState): Promise<ParkedAsk[]> {
    await this.ensureLoaded();
    this.expireDue();
    const items = state ? this._items.filter((item) => item.state === state) : this._items;
    return items.map((item) => ({ ...item, args: { ...item.args } }));
  }

  async pendingCount(): Promise<number> {
    await this.ensureLoaded();
    this.expireDue();
    return this._items.filter((item) => item.state === "pending").length;
  }

  async get(id: string): Promise<ParkedAsk | undefined> {
    await this.ensureLoaded();
    this.expireDue();
    const item = this._items.find((entry) => entry.id === id);
    return item ? { ...item, args: { ...item.args } } : undefined;
  }
}
