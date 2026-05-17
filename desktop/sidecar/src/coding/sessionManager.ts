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

interface SessionRecord {
  id: string;
  model: SidecarModelEntry;
  title: string;
  createdAt: string;
  messages: string[];
  cancelRequested: boolean;
}

export class CodingSessionManager {
  private readonly _sessions = new Map<string, SessionRecord>();
  private readonly _now: () => Date;
  private readonly _idFactory: () => string;

  constructor(opts: { now?: () => Date; idFactory?: () => string } = {}) {
    this._now = opts.now ?? (() => new Date());
    this._idFactory = opts.idFactory ?? (() => randomUUID());
  }

  start(req: CodingSessionStartRequestT): CodingSessionStartResponseT {
    const model = requireModel(req.modelId);
    const id = this._idFactory();
    const createdAt = this._now().toISOString();
    const title = req.title?.trim() || `Session ${id.slice(0, 8)}`;
    this._sessions.set(id, {
      id,
      model,
      title,
      createdAt,
      messages: [],
      cancelRequested: false,
    });
    return {
      sessionId: id,
      modelId: model.id,
      family: model.family,
      createdAt,
    };
  }

  sendMessage(sessionId: string, message: string): readonly CodingSessionEventT[] {
    const rec = this._requireSession(sessionId, "coding.session.sendMessage");
    rec.cancelRequested = false;
    rec.messages.push(message);
    // Phase 3 placeholder: produce a deterministic event stream so the shell,
    // protocol tests, and frontend can render the full union. A future
    // commit hooks NexusCodingRuntime in here.
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
    };
  }

  /** Test surface: count of live sessions. */
  size(): number {
    return this._sessions.size;
  }

  private _requireSession(id: string, method: string): SessionRecord {
    const rec = this._sessions.get(id);
    if (!rec) {
      throw new IpcMethodError(method as never, `unknown sessionId: ${id}`);
    }
    return rec;
  }
}
