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
  CodingSessionDeleteResponseT,
  CodingSessionEventT,
  CodingSessionListResponseT,
  CodingSessionRenameResponseT,
  CodingSessionResumeResponseT,
  CodingSessionStartRequestT,
  CodingSessionStartResponseT,
  CodingSessionSummaryT,
  IpcMethodError,
} from "../protocol.js";
import { estimateTokens } from "../../../../core/chat/sessionContextUsage.js";
import { redactSecrets } from "../../../../core/observability/redactSecrets.js";
import { requireModel, type SidecarModelEntry } from "./models.js";
import type { AgentRunner } from "./headlessAgentRunner.js";
import type { PersistedSession, PersistedTurn, SessionStore } from "./sessionStore.js";
import {
  workspaceScopeFromPersisted,
  type WorkspaceScope,
} from "../../../../core/project/WorkspaceScope.js";

interface SessionTurn {
  prompt: string;
  assistantText: string;
  inputTokens?: number | null;
  reasoningTokens?: number | null;
  reasoningText?: string | null;
  outputTokens?: number | null;
  tokensEstimated?: boolean;
  createdAt?: string;
}

interface SessionRecord {
  id: string;
  model: SidecarModelEntry;
  title: string;
  createdAt: string;
  messages: string[];
  turns: SessionTurn[];
  cancelRequested: boolean;
  /** v2.4.1 -- immutable roots captured when the session starts. */
  workspaceScope?: WorkspaceScope;
}

function scopeFromSession(session: PersistedSession): WorkspaceScope | undefined {
  if (!session.workspaceRoots?.length && !session.workspacePath) return undefined;
  return workspaceScopeFromPersisted({
    workspaceRoots: session.workspaceRoots,
    workspacePath: session.workspacePath,
    primaryRoot: session.primaryRoot,
    workspaceId: session.workspaceId,
    createdAt: session.workspaceCreatedAt,
    lastUsedAt: session.workspaceLastUsedAt,
  });
}

function tokenTextFromEvents(events: readonly CodingSessionEventT[]): string {
  let text = "";
  for (const event of events) {
    if (event.kind === "token") text += event.text;
  }
  return text;
}

function turnsFromRecord(rec: SessionRecord): PersistedTurn[] {
  return rec.messages.map((prompt, index) => rec.turns[index] ?? { prompt, assistantText: "" });
}

function copyTurn(turn: PersistedTurn | SessionTurn): SessionTurn {
  return {
    prompt: turn.prompt,
    assistantText: turn.assistantText,
    inputTokens: turn.inputTokens,
    reasoningTokens: turn.reasoningTokens,
    reasoningText: turn.reasoningText,
    outputTokens: turn.outputTokens,
    tokensEstimated: turn.tokensEstimated,
    createdAt: turn.createdAt,
  };
}

function usageFromCodingEvents(events: readonly CodingSessionEventT[]): {
  inputTokens: number | null;
  reasoningTokens: number | null;
  outputTokens: number | null;
} {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && event.kind === "done") {
      return {
        inputTokens: event.inputTokens ?? null,
        reasoningTokens: event.reasoningTokens ?? null,
        outputTokens: event.outputTokens ?? null,
      };
    }
  }
  return { inputTokens: null, reasoningTokens: null, outputTokens: null };
}

function persistedTurnFromEvents(
  prompt: string,
  events: readonly CodingSessionEventT[],
  now: Date,
): SessionTurn {
  const assistantText = tokenTextFromEvents(events);
  const reasoningText = redactSecrets(
    events
      .filter((event) => event.kind === "reasoning_delta")
      .map((event) => event.text)
      .join(""),
  ).slice(0, 65_536) || null;
  const usage = usageFromCodingEvents(events);
  const hasReported =
    usage.inputTokens != null || usage.reasoningTokens != null || usage.outputTokens != null;
  const createdAt = now.toISOString();
  if (hasReported) {
    return {
      prompt,
      assistantText,
      inputTokens: usage.inputTokens,
      reasoningTokens: usage.reasoningTokens,
      ...(reasoningText ? { reasoningText } : {}),
      outputTokens: usage.outputTokens,
      tokensEstimated: false,
      createdAt,
    };
  }
  return {
    prompt,
    assistantText,
    inputTokens: estimateTokens(prompt),
    outputTokens: estimateTokens(assistantText),
    ...(reasoningText ? { reasoningText } : {}),
    tokensEstimated: true,
    createdAt,
  };
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
        if (s.archivedAt) continue;
        this._sessions.set(s.id, {
          id: s.id,
          model: s.model,
          title: s.title,
          createdAt: s.createdAt,
          messages: [...s.messages],
          turns: (s.turns ?? s.messages.map((prompt) => ({ prompt, assistantText: "" }))).map(
            copyTurn,
          ),
          cancelRequested: false,
          workspaceScope: scopeFromSession(s),
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
      turns: turnsFromRecord(rec),
      ...(rec.workspaceScope
        ? {
            workspacePath: rec.workspaceScope.primaryRoot,
            workspaceId: rec.workspaceScope.workspaceId,
            workspaceRoots: [...rec.workspaceScope.workspaceRoots],
            identityRoots: [...rec.workspaceScope.identityRoots],
            primaryRoot: rec.workspaceScope.primaryRoot,
            workspaceLabel: rec.workspaceScope.displayLabel,
            workspaceCreatedAt: rec.workspaceScope.createdAt,
            workspaceLastUsedAt: rec.workspaceScope.lastUsedAt,
          }
        : {}),
    };
    this._store.upsert(persisted);
  }

  start(req: CodingSessionStartRequestT): CodingSessionStartResponseT {
    const scope =
      req.workspaceRoots?.length || req.workspacePath
        ? workspaceScopeFromPersisted({
            workspaceRoots: req.workspaceRoots,
            workspacePath: req.workspacePath,
            primaryRoot: req.primaryRoot,
            workspaceId: req.workspaceId,
          })
        : undefined;
    return this.startWithScope(req, scope);
  }

  startWithScope(
    req: CodingSessionStartRequestT,
    workspaceScope: WorkspaceScope | undefined,
  ): CodingSessionStartResponseT {
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
      turns: [],
      cancelRequested: false,
      workspaceScope,
    };
    this._sessions.set(id, rec);
    this._persist(rec);
    return {
      sessionId: id,
      modelId: model.id,
      family: model.family,
      createdAt,
      ...(workspaceScope
        ? {
            workspaceId: workspaceScope.workspaceId,
            workspaceRoots: [...workspaceScope.workspaceRoots],
            primaryRoot: workspaceScope.primaryRoot,
          }
        : {}),
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
    const events: readonly CodingSessionEventT[] = this._agentRunner
      ? await this._agentRunner({
          sessionId: rec.id,
          message,
          model: rec.model,
          workspacePath: rec.workspaceScope?.primaryRoot,
          workspaceScope: rec.workspaceScope,
        })
      : [
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
    rec.turns.push(persistedTurnFromEvents(message, events, this._now()));
    this._persist(rec);
    return events;
  }

  cancel(sessionId: string): CodingSessionCancelResponseT {
    const rec = this._requireSession(sessionId, "coding.session.cancel");
    const alreadyCancelled = rec.cancelRequested;
    rec.cancelRequested = true;
    return { sessionId, cancelled: !alreadyCancelled };
  }

  list(): CodingSessionListResponseT {
    const sessions: CodingSessionSummaryT[] = Array.from(this._sessions.values()).map((rec) =>
      this._summary(rec),
    );
    return { sessions };
  }

  resume(sessionId: string): CodingSessionResumeResponseT {
    const rec = this._requireSession(sessionId, "coding.session.resume");
    return {
      session: this._summary(rec),
      // v1.5.0 Phase 5 (item 26): the full message history so the resuming
      // surface restores intact state, not just the summary.
      messages: [...rec.messages],
      turns: turnsFromRecord(rec),
    };
  }

  rename(sessionId: string, title: string): CodingSessionRenameResponseT {
    const rec = this._requireSession(sessionId, "coding.session.rename");
    const next = title.trim();
    if (!next) {
      throw new IpcMethodError("coding.session.rename", "title must be non-empty");
    }
    rec.title = next;
    this._persist(rec);
    return { session: this._summary(rec) };
  }

  delete(sessionId: string): CodingSessionDeleteResponseT {
    this._requireSession(sessionId, "coding.session.delete");
    this._sessions.delete(sessionId);
    this._store?.delete(sessionId);
    return { sessionId, deleted: true };
  }

  archive(sessionId: string): { sessionId: string; archivedAt: string } {
    this._requireSession(sessionId, "sessions.archive");
    if (!this._store) throw new IpcMethodError("sessions.archive", "session storage is unavailable");
    const archivedAt = this._now().toISOString();
    this._store.archive(sessionId, archivedAt);
    this._sessions.delete(sessionId);
    return { sessionId, archivedAt };
  }

  listArchived(): readonly PersistedSession[] {
    return this._store?.listArchived() ?? [];
  }

  restore(sessionId: string): { session: CodingSessionSummaryT; parentFallback: false } {
    if (!this._store) throw new IpcMethodError("sessions.restore", "session storage is unavailable");
    const s = this._store.restore(sessionId);
    const rec: SessionRecord = {
      id: s.id,
      model: s.model,
      title: s.title,
      createdAt: s.createdAt,
      messages: [...s.messages],
      turns: (s.turns ?? s.messages.map((prompt) => ({ prompt, assistantText: "" }))).map(copyTurn),
      cancelRequested: false,
      workspaceScope: scopeFromSession(s),
    };
    this._sessions.set(rec.id, rec);
    return { session: this._summary(rec), parentFallback: false };
  }

  private _summary(rec: SessionRecord): CodingSessionSummaryT {
    return {
      sessionId: rec.id,
      modelId: rec.model.id,
      family: rec.model.family,
      title: rec.title,
      createdAt: rec.createdAt,
      messageCount: rec.messages.length,
      ...(rec.workspaceScope
        ? {
            workspaceId: rec.workspaceScope.workspaceId,
            workspaceRoots: [...rec.workspaceScope.workspaceRoots],
            primaryRoot: rec.workspaceScope.primaryRoot,
          }
        : {}),
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
