// v1.0.0 Phase 3.1 -- CodingSessionManager.
//
// In-memory implementation of the Coding-module session surface that the
// JSON-RPC handlers route into. The real runtime (`NexusCodingRuntime`,
// formerly `GemmaCodingRuntime`) still lives under `src/runtime/`; Phase 3
// wires the IPC contract against this lightweight manager so the desktop
// shell, sidecar tests, and frontend can all develop against a stable
// surface. Phase 3 follow-on work (tracked in v1.0.0 known-gaps) replaces
// the canned event responder with a real `NexusCodingRuntime` instance once
// the engine completes its physical move from `src/` to `modules/coding/`.

import { randomUUID } from "node:crypto";
import {
  CodingSessionCancelResponseT,
  CodingSessionEventT,
  CodingSessionListResponseT,
  CodingSessionResumeResponseT,
  CodingSessionStartRequestT,
  CodingSessionStartResponseT,
  CodingSessionSummaryT,
  IpcMethodError,
} from "../protocol.js";
import { requireModel, type SidecarModelEntry } from "./models.js";
import type { AgentRunner } from "./headlessAgentRunner.js";
import type { PersistedSession, SessionStore } from "./sessionStore.js";

interface SessionRecord {
  id: string;
  model: SidecarModelEntry;
  title: string;
  createdAt: string;
  messages: string[];
  cancelRequested: boolean;
  /** v1.7.0 -- project root the headless agent's tools are scoped to (in-memory). */
  workspacePath?: string;
}

export class CodingSessionManager {
  private readonly _sessions = new Map<string, SessionRecord>();
  private readonly _locks = new Map<string, Promise<void>>();
  private readonly _now: () => Date;
  private readonly _idFactory: () => string;
  private readonly _store: SessionStore | undefined;
  private readonly _agentRunner: AgentRunner | undefined;

  constructor(
    opts: {
      now?: () => Date;
      idFactory?: () => string;
      store?: SessionStore;
      /**
       * v1.7.0 -- production agent runner over the headless runtime. When
       * injected, `sendMessage` drives a real agent turn; when omitted (tests,
       * bare dev), it falls back to the deterministic placeholder event stream.
       */
      agentRunner?: AgentRunner;
    } = {},
  ) {
    this._now = opts.now ?? (() => new Date());
    this._idFactory = opts.idFactory ?? (() => randomUUID());
    this._store = opts.store;
    this._agentRunner = opts.agentRunner;
    // v1.5.0 Phase 5 (item 26): hydrate from the shared store so a session
    // started in another surface (e.g. the CLI) is visible + resumable here.
    if (this._store) {
      for (const s of this._store.list()) {
        this._sessions.set(s.id, {
          id: s.id,
          model: s.model,
          title: s.title,
          createdAt: s.createdAt,
          messages: [...s.messages],
          cancelRequested: false,
        });
      }
    }
  }

  /** Project a live record to its persisted shape and write it through. */
  private _persist(rec: SessionRecord): void {
    if (!this._store) return;
    const persisted: PersistedSession = {
      id: rec.id,
      model: rec.model,
      title: rec.title,
      createdAt: rec.createdAt,
      messages: [...rec.messages],
    };
    this._store.upsert(persisted);
  }

  start(req: CodingSessionStartRequestT): CodingSessionStartResponseT {
    const model = requireModel(req.modelId);
    const id = this._idFactory();
    const createdAt = this._now().toISOString();
    const title = req.title?.trim() || `Session ${id.slice(0, 8)}`;
    const rec: SessionRecord = {
      id,
      model,
      title,
      createdAt,
      messages: [],
      cancelRequested: false,
      workspacePath: req.workspacePath,
    };
    this._sessions.set(id, rec);
    this._persist(rec);
    return {
      sessionId: id,
      modelId: model.id,
      family: model.family,
      createdAt,
    };
  }

  async sendMessage(
    sessionId: string,
    message: string,
  ): Promise<readonly CodingSessionEventT[]> {
    return this._withSessionLock(sessionId, () => this._sendMessageUnlocked(sessionId, message));
  }

  private async _sendMessageUnlocked(
    sessionId: string,
    message: string,
  ): Promise<readonly CodingSessionEventT[]> {
    const rec = this._requireSession(sessionId, "coding.session.sendMessage");
    rec.cancelRequested = false;
    rec.messages.push(message);
    this._persist(rec);
    // v1.7.0: when a production agent runner is injected, drive a real headless
    // agent turn (scoped to the session's workspace). The persist above is
    // synchronous, so a fire-and-forget caller still records the message.
    if (this._agentRunner) {
      return this._agentRunner({
        sessionId: rec.id,
        message,
        model: rec.model,
        workspacePath: rec.workspacePath,
      });
    }
    // Fallback (tests / bare dev): a deterministic placeholder event stream so
    // the shell, protocol tests, and frontend can render the full union.
    const events: CodingSessionEventT[] = [
      { kind: "token", text: `Acknowledged: ${message.slice(0, 80)}` },
      {
        kind: "toolCallHeader",
        callId: `${rec.id}:tc-1`,
        name: "noop_echo",
      },
      {
        kind: "toolCallArgDelta",
        callId: `${rec.id}:tc-1`,
        delta: JSON.stringify({ echo: message.slice(0, 32) }),
      },
      {
        kind: "toolCallComplete",
        callId: `${rec.id}:tc-1`,
        result: `engine=${rec.model.family}`,
      },
      { kind: "done", finishReason: rec.cancelRequested ? "cancelled" : "stop" },
    ];
    return events;
  }

  cancel(sessionId: string): CodingSessionCancelResponseT {
    const rec = this._requireSession(sessionId, "coding.session.cancel");
    const alreadyCancelled = rec.cancelRequested;
    rec.cancelRequested = true;
    return { sessionId, cancelled: !alreadyCancelled };
  }

  list(): CodingSessionListResponseT {
    const sessions: CodingSessionSummaryT[] = Array.from(this._sessions.values()).map(
      (rec) => ({
        sessionId: rec.id,
        modelId: rec.model.id,
        family: rec.model.family,
        title: rec.title,
        createdAt: rec.createdAt,
        messageCount: rec.messages.length,
      }),
    );
    return { sessions };
  }

  resume(sessionId: string): CodingSessionResumeResponseT {
    const rec = this._requireSession(sessionId, "coding.session.resume");
    return {
      session: {
        sessionId: rec.id,
        modelId: rec.model.id,
        family: rec.model.family,
        title: rec.title,
        createdAt: rec.createdAt,
        messageCount: rec.messages.length,
      },
      // v1.5.0 Phase 5 (item 26): the full message history so the resuming
      // surface restores intact state, not just the summary.
      messages: [...rec.messages],
    };
  }

  /** Test surface: count of live sessions. */
  size(): number {
    return this._sessions.size;
  }

  private async _withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this._locks.get(sessionId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this._locks.set(
      sessionId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private _requireSession(id: string, method: string): SessionRecord {
    const rec = this._sessions.get(id);
    if (!rec) {
      throw new IpcMethodError(method as never, `unknown sessionId: ${id}`);
    }
    return rec;
  }
}
