import type { OllamaClient, OllamaMessage, OllamaOptions, OllamaToolDefinition } from "../../modules/coding/llm/types.js";
import type { ConversationManager } from "../../modules/coding/chat/ConversationManager.js";
import type { PostMessageFn } from "../../modules/coding/chat/StreamingPipeline.js";
import { toLlmMessages } from "../../modules/coding/chat/llmMessages.js";
import { isVisionCapableModel } from "../../modules/coding/config/ModelCapabilities.js";
import type { ContextCompactor } from "../../modules/coding/chat/ContextCompactor.js";
import type { SubAgentSpawner } from "../../modules/coding/agents/SubAgentSpawner.types.js";
import type { SubAgentConfig, SubAgentResult } from "../../modules/coding/agents/types.js";
import { parseToolCalls, stripToolCalls, formatToolResult } from "./ToolCallParser.js";
import type { ToolRegistry } from "./ToolRegistry.js";
import type { BudgetMiddleware } from "./BudgetMiddleware.js";
import type { ToolCall, ToolResult } from "./types.js";
import type { InboundClassifier } from "../../modules/coding/security/InboundClassifier.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import type { WorkingMemory } from "../storage/WorkingMemory.js";
import type { EpisodicMemory } from "../storage/EpisodicMemory.js";
import { recordToolEvent } from "../storage/EpisodicMemory.js";
import type { LoopDetector } from "../../modules/coding/guardrails/LoopDetector.js";
import type { GitSafetyNet, GitCheckpoint } from "../../modules/coding/guardrails/GitSafetyNet.js";
import { classifyAction, ActionRisk } from "../../modules/coding/guardrails/ActionClassifier.js";
import { Tracer, type SkillSpanContext } from "../../modules/coding/observability/Tracer.js";
import type { OperationLog } from "../../modules/coding/observability/OperationLog.js";
import { formatForUser } from "../../modules/coding/utils/errors.js";
import { countTokens } from "../../modules/coding/config/PromptBudget.js";
import type { HookBus } from "../../core/lifecycle/HookBus.js";
import { redactSecrets } from "../../core/observability/redactSecrets.js";
import {
  metricSpanAttributes,
  sharedInferenceMetrics,
} from "../../core/observability/InferenceMetrics.js";

const DEFAULT_MAX_ITERATIONS = 20;

const FILE_EDIT_TOOLS = new Set(["write_file", "edit_file", "create_file"]);
const EPISODIC_TOOLS = new Set(["write_file", "edit_file", "create_file", "run_terminal", "grep_codebase"]);

/**
 * v1.5.0 Phase 3 (item 3) -- tools that return untrusted external content. Their
 * successful output is routed through the inbound prompt-injection classifier
 * before it is folded into the agent context (warn-then-allow annotation).
 */
// v1.16.0 Phase 4 (A6): `parse_document` joins the set -- OCR text from a
// workspace document is external, attacker-influenceable content exactly like
// a fetched web page, so it gets the same untrusted-content annotation.
const INBOUND_EXTERNAL_DATA_TOOLS = new Set(["fetch_page", "web_search", "parse_document"]);

/**
 * v0.8.0 Phase 2 (item C8) -- tools whose successful invocation counts as
 * "verification" for pass-state gating. A run_terminal call that exited 0
 * (lint, build, test, golden task, custom check command) is the canonical
 * signal that the work was actually verified rather than self-declared.
 */
const VERIFICATION_TOOLS = new Set(["run_terminal"]);

/**
 * v0.9.0 Phase 6.2 -- sub-agent kinds whose successful return credits the
 * pass-state gate. A verification, audit-worker, testgaps-worker, or
 * curator-worker that returns `{success: true}` substitutes for a direct
 * `run_terminal` invocation by the parent loop. Reflect-worker is excluded
 * because its dry-run does not assert correctness of recent edits.
 */
const SUB_AGENT_VERIFICATION_TYPES = new Set<import("../../modules/coding/agents/types.js").SubAgentType>([
  "verification",
  "audit-worker",
  "testgaps-worker",
  "curator-worker",
]);

const MAX_RECENT_TOOL_RESULTS = 5;

/**
 * v0.8.0 Phase 2 (item C8) -- system message injected when the agent tries
 * to terminate without a verification-class tool call since the last user
 * message. The wording is paired with `passStateGating` so the agent can
 * recover by running a real check rather than re-emitting "done".
 */
const PASS_STATE_GATING_NUDGE =
  "[SYSTEM] Task cannot complete without verification. Run a verification tool " +
  "(lint, build, test, or relevant check) and re-emit the completion signal.";

/**
 * Phase 5 (v0.5.0): delegates to `countTokens` so AgentLoop's per-turn
 * accounting follows the same path as CompactionStrategy / PromptBuilder
 * (tiktoken when loaded, chars/4 heuristic otherwise).
 */
function estimateTokensForString(text: string): number {
  return countTokens(text);
}

export interface AgentLoopOptions {
  readonly subAgentManager?: SubAgentSpawner;
  readonly verificationThreshold?: number;
  readonly verificationEnabled?: boolean;
  /**
   * v0.7.0 Phase 7 (C34): fire the audit-worker sub-agent at the same
   * post-N-edits trigger as verification. Off by default.
   */
  readonly auditWorkerEnabled?: boolean;
  /**
   * v0.7.0 Phase 7 (C34): fire the testgaps-worker sub-agent at the same
   * post-N-edits trigger as verification. Off by default.
   */
  readonly testgapsWorkerEnabled?: boolean;
  /**
   * v0.8.0 Phase 5 sub-task 5.2: fire the curator-worker sub-agent. Unlike
   * audit/testgaps the curator is cadence-gated (12 h minimum between runs)
   * and reuses the same edit-threshold trigger as a cheap idle proxy. Off by
   * default. Tests can lower the cadence via `curatorWorkerMinIntervalMs`.
   */
  readonly curatorWorkerEnabled?: boolean;
  readonly curatorWorkerMinIntervalMs?: number;
  readonly budgetMiddleware?: BudgetMiddleware;
  readonly workingMemory?: WorkingMemory;
  readonly episodicMemory?: EpisodicMemory;
  readonly sessionId?: string;
  readonly loopDetector?: LoopDetector;
  readonly gitSafetyNet?: GitSafetyNet;
  /**
   * Tracer instance. Constructor-injected from the composition root so the
   * loop never reaches into shared static state. Falls back to a disabled
   * tracer (zero-cost no-ops) when omitted.
   */
  readonly tracer?: Tracer;
  /**
   * Phase 9 (v0.5.0): opt-in append-only operation log. When provided AND
   * `OperationLog.isEnabled()` is true, the loop records one metadata-only
   * line per tool call. Records `<redacted>` for any path matching the
   * secret-path denylist. Default: not provided -> no log writes.
   */
  readonly operationLog?: OperationLog;
  /**
   * Maximum context window in tokens. Posted alongside the running token
   * count so the webview can render an accurate progress bar. When omitted
   * the loop emits `limit: 0` to signal "unknown" (legacy behavior).
   */
  readonly maxTokens?: number;
  /**
   * Default tool-call source attribution. Used by ConfirmationGate to label
   * confirmation prompts with the originating peer (local agent vs.
   * verification sub-agent). Closes pen-test F-004.
   */
  readonly toolCallSource?: import("./types.js").ToolCallSource;
  /**
   * v0.8.0 Phase 2 (item C8) -- when true (default), the loop refuses to
   * terminate via a no-tool-call "done" response unless at least one
   * verification-class tool call has succeeded since the last user message.
   * When the gate trips, a nudge system message is injected and the loop
   * continues for one more iteration so the agent can run the missing check.
   * Disable for non-coding workflows or tests that cannot run real commands.
   */
  readonly passStateGating?: boolean;
  /**
   * v0.9.0 Phase 6.2 -- when true (default), a successful verification /
   * audit / testgaps / curator sub-agent dispatch credits the pass-state
   * gate so the parent loop does not need to also run a verification tool
   * call before terminating. Disable to require parent-level verification
   * regardless of sub-agent outcomes (legacy v0.8.0 behaviour).
   */
  readonly subAgentVerificationCredit?: boolean;
  /**
   * v1.1.0 Phase 4.3 -- typed lifecycle event surface. When provided the
   * loop emits `lifecycle.session.start` / `lifecycle.session.stop` at
   * the run boundaries and `lifecycle.tool.pre` / `lifecycle.tool.post`
   * / `lifecycle.tool.failed` around each `_registry.execute` call.
   * When omitted the emits are no-ops (legacy behavior).
   */
  readonly hookBus?: HookBus;
  /**
   * v1.4.0 Phase 8 (gap 5.2.P3.Q) -- optional path-scoped skill source. When
   * provided, {@link AgentLoop.reevaluateSkillsForPath} recomputes the active
   * skill set as the agent's editing focus changes and emits a
   * `lifecycle.skill.entry` for each newly-active path-scoped skill. When
   * omitted the method is a no-op (legacy behavior).
   */
  readonly skillCatalog?: PathScopedSkillSource;
  /**
   * v1.4.0 Phase 8 (gap 5.2.P3.Q) -- supplies the agent's current editing
   * focus (workspace-relative path, or null) at the start of each run. When
   * both this and `skillCatalog` are provided, the loop reevaluates the
   * path-scoped skill set at run start so skills activate/deactivate as the
   * focus changes between turns.
   */
  readonly activeEditPathProvider?: () => string | null;
  /**
   * v1.5.0 Phase 3 (item 3) -- inbound prompt-injection classifier. When
   * provided AND {@link inboundClassifierEnabled} is true, the successful
   * output of inbound external-data tools (`fetch_page`, `web_search`) is
   * screened and -- if flagged -- annotated with an untrusted-content banner
   * before it enters the agent context. Warn-then-allow: content is never
   * dropped. When omitted (or disabled) the screening is a no-op (legacy
   * behavior).
   */
  readonly inboundClassifier?: InboundClassifier;
  /**
   * v1.5.0 Phase 3 (item 3) -- master toggle for the inbound classifier
   * (mirrors `nexus.coding.inboundClassifier.enabled`, default on). When false
   * the classifier is bypassed entirely even if one is wired.
   */
  readonly inboundClassifierEnabled?: boolean;
}

/**
 * v1.4.0 Phase 8 (gap 5.2.P3.Q) -- the minimal structural surface the loop
 * needs from a skill catalog: recompute the visible skill set for the active
 * editing path. Satisfied by `core/skills/SkillCatalog.InMemorySkillCatalog`
 * (its `reevaluatePathScope` returns `SkillRecord[]`). Kept structural so
 * `src/tools` does not take a hard dependency on the core skills module.
 */
export interface PathScopedSkillSource {
  reevaluatePathScope(
    currentPath: string | null,
  ): readonly { readonly id: string; readonly provenance: { readonly source: "builtin" | "user" | "nexus-hub" } }[];
}

export class AgentLoop {
  private _cancelled = false;
  private _abortController: AbortController | null = null;
  private _fileEditCount = 0;
  private readonly _modifiedFiles: string[] = [];
  private readonly _recentToolResults: string[] = [];

  private readonly _subAgentManager?: SubAgentSpawner;
  private readonly _verificationThreshold: number;
  private readonly _verificationEnabled: boolean;
  private readonly _auditWorkerEnabled: boolean;
  private readonly _testgapsWorkerEnabled: boolean;
  // v1.1.0 Phase 1.7: the legacy `curatorWorkerEnabled` /
  // `curatorWorkerMinIntervalMs` / `_curatorLastRunAt` triple was removed
  // when the edit-threshold curator fallback was deleted. The options remain
  // accepted by the constructor for back-compat with existing callers but
  // are intentionally not stored.
  private _budgetMiddleware?: BudgetMiddleware;
  private readonly _workingMemory?: WorkingMemory;
  private readonly _episodicMemory?: EpisodicMemory;
  private readonly _sessionId?: string;
  private readonly _loopDetector?: LoopDetector;
  private readonly _gitSafetyNet?: GitSafetyNet;
  private readonly _maxTokens: number;
  private readonly _tracer: Tracer;
  private readonly _operationLog?: OperationLog;
  private readonly _toolCallSource?: import("./types.js").ToolCallSource;
  private readonly _passStateGating: boolean;
  private readonly _subAgentVerificationCredit: boolean;
  private readonly _hookBus?: HookBus;
  private readonly _skillCatalog?: PathScopedSkillSource;
  private readonly _activeEditPathProvider?: () => string | null;
  private readonly _inboundClassifier?: InboundClassifier;
  private readonly _inboundClassifierEnabled: boolean;
  /** v1.4.0 Phase 8 (gap 5.2.P3.Q): ids of the currently-active path-scoped skills. */
  private _activePathScopedSkillIds: readonly string[] = [];
  /**
   * Resets at the start of `run()` and flips to true when a
   * verification-class tool call succeeds. Used by the pass-state gate to
   * reject "done" terminations that have not been backed by a real check.
   */
  private _verifiedSinceUserMessage = false;
  /**
   * Tracks whether the gate has already injected the nudge this turn so a
   * model that keeps emitting "done" cannot bounce between the nudge and
   * a fresh user-visible error forever. After one nudge the gate falls
   * through, the agent terminates, and the operator sees the trace.
   */
  private _gateNudgeIssued = false;
  private _gitCheckpoint: GitCheckpoint | null = null;
  private _traceId = "";
  private _rootSpanId = "";

  constructor(
    private readonly _client: OllamaClient,
    private readonly _manager: ConversationManager,
    private readonly _registry: ToolRegistry,
    private readonly _modelName: string,
    private readonly _maxIterations: number = DEFAULT_MAX_ITERATIONS,
    private readonly _compactor?: ContextCompactor,
    private readonly _ollamaOptions?: OllamaOptions,
    private readonly _tools?: OllamaToolDefinition[],
    options?: AgentLoopOptions,
  ) {
    this._subAgentManager = options?.subAgentManager;
    this._verificationThreshold = options?.verificationThreshold ?? 3;
    this._verificationEnabled = options?.verificationEnabled ?? true;
    this._auditWorkerEnabled = options?.auditWorkerEnabled ?? false;
    this._testgapsWorkerEnabled = options?.testgapsWorkerEnabled ?? false;
    // v1.1.0 Phase 1.7: curator options accepted for compat, intentionally
    // unused. The curator now runs exclusively via the IdleTimeScheduler
    // task registered in the composition root.
    void options?.curatorWorkerEnabled;
    void options?.curatorWorkerMinIntervalMs;
    this._budgetMiddleware = options?.budgetMiddleware;
    this._workingMemory = options?.workingMemory;
    this._episodicMemory = options?.episodicMemory;
    this._sessionId = options?.sessionId;
    this._loopDetector = options?.loopDetector;
    this._gitSafetyNet = options?.gitSafetyNet;
    this._maxTokens = options?.maxTokens ?? 0;
    this._tracer = options?.tracer ?? new Tracer();
    this._operationLog = options?.operationLog;
    this._toolCallSource = options?.toolCallSource;
    this._passStateGating = options?.passStateGating ?? true;
    this._subAgentVerificationCredit = options?.subAgentVerificationCredit ?? true;
    this._hookBus = options?.hookBus;
    this._skillCatalog = options?.skillCatalog;
    this._activeEditPathProvider = options?.activeEditPathProvider;
    this._inboundClassifier = options?.inboundClassifier;
    this._inboundClassifierEnabled = options?.inboundClassifierEnabled ?? true;
  }

  /**
   * v0.9.0 Phase 6.2 -- credit a successful verification-class sub-agent
   * run toward the parent loop's pass-state gate. No-op when the credit
   * option is disabled or the sub-agent type is not in the verification
   * set. Test surface: exposed for direct invocation when callers wire
   * dispatch outside `_runOneIteration`.
   */
  creditSubAgentVerification(result: SubAgentResult): void {
    if (!this._subAgentVerificationCredit) return;
    if (!result.success) return;
    if (!SUB_AGENT_VERIFICATION_TYPES.has(result.type)) return;
    this._verifiedSinceUserMessage = true;
  }

  /** Set or replace the budget middleware (used for async tier config updates). */
  setBudgetMiddleware(middleware: BudgetMiddleware): void {
    this._budgetMiddleware = middleware;
  }

  cancel(): void {
    this._cancelled = true;
    this._abortController?.abort();
  }

  /** Files modified during this agent loop session (tracked via write/edit/create calls). */
  getModifiedFiles(): readonly string[] {
    return [...this._modifiedFiles];
  }

  /** The last git checkpoint created at the start of run(), if any. */
  getLastCheckpoint(): GitCheckpoint | null {
    return this._gitCheckpoint;
  }

  /** The trace ID for this agent loop session, if tracing is active. */
  getTraceId(): string {
    return this._traceId;
  }

  /** Recent tool result summaries (last 5). */
  getRecentToolResults(): readonly string[] {
    return [...this._recentToolResults];
  }

  /**
   * v1.1.0 Phase 8.5 -- set or clear the active skill context. While set,
   * the underlying tracer folds `skill.{id,namespace,...}` attributes
   * into every `tool_call` / `sub_agent` span (see `Tracer.startSpan`).
   * When a non-null skill is supplied AND the HookBus is wired, a
   * `lifecycle.skill.entry` event is emitted on the bus so consumers
   * (Memory panel provenance chips, audit CLI, trace replay) see the
   * dispatch. Clearing (`null`) does not emit; the entry-only signal
   * is sufficient for the audit trail.
   */
  setCurrentSkill(skill: SkillSpanContext | null): void {
    this._tracer.setCurrentSkill(skill);
    if (skill && this._hookBus && this._sessionId) {
      this._hookBus.emit({
        kind: "lifecycle.skill.entry",
        sessionId: this._sessionId,
        skillId: skill.id,
        namespace: skill.namespace,
        parentSpanId: this._rootSpanId || undefined,
      });
    }
  }

  /**
   * v1.4.0 Phase 8 (gap 5.2.P3.Q) -- recompute the active path-scoped skill
   * set as the agent's editing focus changes. Callers invoke this when the
   * active editor / CWD changes (the panel wires it to
   * `onDidChangeActiveTextEditor`). When a skill catalog is wired, it asks the
   * catalog for the skills visible at `activeEditPath` and emits a
   * `lifecycle.skill.entry` for each newly-active path-scoped skill (mirroring
   * {@link setCurrentSkill}'s audit signal), then returns the active id set.
   * A no-op returning the prior set when no catalog is wired.
   */
  reevaluateSkillsForPath(activeEditPath: string | null): readonly string[] {
    if (!this._skillCatalog) return this._activePathScopedSkillIds;
    const records = this._skillCatalog.reevaluatePathScope(activeEditPath);
    const previous = new Set(this._activePathScopedSkillIds);
    if (this._hookBus && this._sessionId) {
      for (const record of records) {
        if (previous.has(record.id)) continue;
        this._hookBus.emit({
          kind: "lifecycle.skill.entry",
          sessionId: this._sessionId,
          skillId: record.id,
          namespace: record.provenance.source,
          parentSpanId: this._rootSpanId || undefined,
        });
      }
    }
    this._activePathScopedSkillIds = records.map((r) => r.id);
    return this._activePathScopedSkillIds;
  }

  /** v1.4.0 Phase 8 (gap 5.2.P3.Q): the active path-scoped skill ids (test/debug surface). */
  getActivePathScopedSkillIds(): readonly string[] {
    return this._activePathScopedSkillIds;
  }

  /** Manually spawn a sub-agent. Returns the sub-agent's result. */
  async spawnSubAgent(config: SubAgentConfig, postMessage: PostMessageFn): Promise<SubAgentResult | null> {
    if (!this._subAgentManager) return null;

    // v1.1.0 Phase 4.3 -- emit lifecycle.subagent.start before the
    // dispatch and lifecycle.subagent.stop after the dispatch returns.
    if (this._hookBus && this._sessionId) {
      this._hookBus.emit({
        kind: "lifecycle.subagent.start",
        sessionId: this._sessionId,
        role: config.type,
        parentSpanId: this._rootSpanId || undefined,
      });
    }

    const result = await this._subAgentManager.run(config, postMessage);

    if (this._hookBus && this._sessionId) {
      this._hookBus.emit({
        kind: "lifecycle.subagent.stop",
        sessionId: this._sessionId,
        role: config.type,
        ok: result?.success ?? false,
        parentSpanId: this._rootSpanId || undefined,
      });
    }

    return result;
  }

  /**
   * Run the agentic loop:
   *  1. Stream a model response.
   *  2. If the response contains tool calls, execute them and loop.
   *  3. If no tool calls remain, commit the message and stop.
   *  4. Stop after maxIterations to prevent infinite loops.
   *  5. After the final response, trigger auto-compaction if needed.
   */
  async run(postMessage: PostMessageFn): Promise<void> {
    // If cancel() was called before run() (e.g. a stale cancel from the prior session),
    // honour it: exit immediately and reset so the next call can proceed.
    if (this._cancelled) {
      this._cancelled = false;
      return;
    }
    this._cancelled = false;
    this._loopDetector?.reset();

    // v0.8.0 Phase 2 (item C8): pass-state gate resets per user message.
    // A new top-level run() call corresponds to a new user message, so any
    // verification credit from the previous turn does not carry over.
    this._verifiedSinceUserMessage = false;
    this._gateNudgeIssued = false;

    // Start a trace for this agent loop session.
    const tracer = this._tracer;
    this._traceId = tracer.startTrace(this._sessionId);
    this._rootSpanId = tracer.getRootSpanId(this._traceId);

    // v1.1.0 Phase 4.3 -- emit lifecycle.session.start. The HookBus
    // subscribers (Memory panel provenance chips, audit CLI, trace
    // replay) get a typed payload; the underlying TelemetryBus
    // re-publishes for trace-side consumers.
    const sessionStartMs = Date.now();
    if (this._hookBus && this._sessionId) {
      this._hookBus.emit({
        kind: "lifecycle.session.start",
        sessionId: this._sessionId,
        modelId: this._modelName,
        isoTime: new Date(sessionStartMs).toISOString(),
      });
    }

    // v1.4.0 Phase 8 (gap 5.2.P3.Q): reevaluate path-scoped skills against the
    // current editing focus at the start of each run, so skills activate /
    // deactivate as the focus changes between turns. No-op unless both a
    // skill catalog and an active-edit-path provider are wired.
    if (this._skillCatalog && this._activeEditPathProvider) {
      this.reevaluateSkillsForPath(this._activeEditPathProvider());
    }

    // Pass trace context to compactor so compaction spans are linked.
    if (this._compactor) {
      this._compactor.setTraceContext(this._traceId, this._rootSpanId);
    }

    // Git safety: create a checkpoint before the agent modifies files.
    if (this._gitSafetyNet) {
      this._gitCheckpoint = await this._gitSafetyNet.createCheckpoint();
      if (this._gitCheckpoint) {
        postMessage({ type: "gitCheckpoint", sha: this._gitCheckpoint.headSha, filesChanged: 0 });
      }
    }

    for (let iteration = 0; iteration < this._maxIterations; iteration++) {
      if (this._cancelled) {
        this._emitSessionStop(sessionStartMs);
        return;
      }
      const verdict = await this._runOneIteration(iteration, tracer, postMessage);
      if (verdict === "done" || verdict === "abort") {
        this._emitSessionStop(sessionStartMs);
        return;
      }
    }

    // Git safety: commit agent-modified files after the loop finishes.
    if (this._gitSafetyNet && this._modifiedFiles.length > 0 && this._gitCheckpoint) {
      await this._gitSafetyNet.commitAgentChanges(
        this._modifiedFiles,
        `agent session: ${this._modifiedFiles.length} file(s) modified`,
      );
    }

    // Max iterations reached.
    postMessage({
      type: "error",
      text: `Agent loop reached the maximum of ${this._maxIterations} iterations and stopped.`,
    });
    this._emitSessionStop(sessionStartMs);
  }

  /**
   * v1.1.0 Phase 4.3 -- emit `lifecycle.session.stop`. Centralized in a
   * helper so every return path in `run()` posts the same payload shape
   * (sessionId, isoTime, durationMs).
   */
  private _emitSessionStop(startedAtMs: number): void {
    if (!this._hookBus || !this._sessionId) return;
    const stopMs = Date.now();
    const isoTime = new Date(stopMs).toISOString();
    this._hookBus.emit({
      kind: "lifecycle.session.stop",
      sessionId: this._sessionId,
      isoTime,
      durationMs: stopMs - startedAtMs,
    });
    // v1.4.0 Phase 8 (gap 5.4.P3.T): fire the 13th lifecycle event once at
    // session end, carrying the transcript + the files written this session,
    // so an attached SessionReflectionHook can draft a reflection artifact.
    // Guarded by the same hookBus/sessionId check; a no-op when no bus is wired.
    this._hookBus.emit({
      kind: "lifecycle.session.reflection",
      sessionId: this._sessionId,
      isoTime,
      transcript: this._buildSessionTranscript(),
      filesWritten: [...this._modifiedFiles],
      modelId: this._modelName,
    });
  }

  /**
   * v1.4.0 Phase 8 (gap 5.4.P3.T): join the conversation history into a single
   * newline-delimited transcript for the reflection event. Defensive against
   * history shapes that lack a string `content`.
   */
  private _buildSessionTranscript(): string {
    try {
      return this._manager
        .getHistory()
        .map((m) => {
          const role = typeof m.role === "string" ? m.role : "unknown";
          const content = typeof m.content === "string" ? m.content : "";
          return `${role}: ${content}`;
        })
        .join("\n\n");
    } catch {
      return "";
    }
  }

  /**
   * Run one agent iteration: pre-turn checks, model stream, tool execution,
   * post-iteration bookkeeping. Returns a verdict telling `run` whether to
   * continue, exit on success, or abort due to error/cancellation.
   */
  private async _runOneIteration(
    iteration: number,
    tracer: Tracer,
    postMessage: PostMessageFn,
  ): Promise<"continue" | "done" | "abort"> {
    const iterSpanId = tracer.startSpan(
      this._traceId,
      `iteration_${iteration}`,
      "agent_turn",
      this._rootSpanId,
      { iteration },
    );

    // Budget pre-turn check (when middleware is provided).
    if (this._budgetMiddleware) {
      const check = this._budgetMiddleware.checkPreTurn();
      if (!check.allowed) {
        if (check.action === "compact" && this._compactor) {
          // v0.8.0 Phase 6.1: inspect the three-state result. `rebuild-needed`
          // means the snapshot path must take over; we currently fall back to
          // a soft abort so the operator sees the reason rather than a silent
          // truncation. A future cycle will wire snapshot restore here.
          const compactResult = await this._compactor.compact(postMessage, true);
          if (compactResult.state === "error") {
            postMessage({ type: "error", text: `Compaction failed: ${compactResult.error}` });
            return "abort";
          }
          if (compactResult.state === "rebuild-needed") {
            postMessage({
              type: "error",
              text: `Conversation cannot be compacted further (${compactResult.reason}). Start a new session or restore from a memory snapshot.`,
            });
            return "abort";
          }
          const recheck = this._budgetMiddleware.checkPreTurn();
          if (!recheck.allowed) {
            postMessage({ type: "error", text: `Budget exhausted: ${recheck.reason}` });
            return "abort";
          }
        } else {
          postMessage({ type: "error", text: `Budget exhausted: ${check.reason}` });
          return "abort";
        }
      }
    }

    // Stream the next model response.
    const llmSpanId = tracer.startSpan(
      this._traceId,
      "stream_one_turn",
      "llm_call",
      iterSpanId,
      { model: this._modelName },
    );
    const accumulated = await this._streamOneTurn(postMessage);

    if (accumulated === null) {
      tracer.endSpan(llmSpanId, "cancelled");
      tracer.endSpan(iterSpanId, "cancelled");
      return "abort";
    }
    // v1.16.0 Phase 2.2 (adoption item A2): attach the per-request inference
    // metrics the instrumented LLM client just recorded (tokens, TTFT,
    // tokens/sec, resident memory) to this span. The span already carries
    // `model`, so the trace dashboard and any OTLP consumer get a per-model
    // breakdown for free. Absent metrics contribute no attributes at all rather
    // than zeros -- see metricSpanAttributes.
    const lastMetric = sharedInferenceMetrics().lastFor(this._modelName);
    tracer.endSpan(llmSpanId, "ok", {
      responseLength: accumulated.length,
      ...(lastMetric ? metricSpanAttributes(lastMetric) : {}),
    });

    // Record per-turn token usage so session-level budget gating fires next turn.
    if (this._budgetMiddleware) {
      const turnTokens = estimateTokensForString(accumulated);
      const turnResult = this._budgetMiddleware.recordTurnTokens(turnTokens);
      if (!turnResult.allowed) {
        postMessage({ type: "error", text: `Budget exceeded: ${turnResult.reason}` });
        tracer.endSpan(iterSpanId, "error", { reason: turnResult.reason });
        return "abort";
      }
    }

    // Single parse pass: the previous code parsed once for presence and again
    // for the results. `parseToolCalls` now surfaces both in one scan.
    const { results: parseResults, hasAny } = parseToolCalls(accumulated);

    if (!hasAny) {
      // v0.8.0 Phase 2 (item C8): pass-state gate. Refuse to terminate
      // unless a verification-class tool call has succeeded since the
      // last user message. The gate fires once per turn; if the agent
      // still emits a tool-less response after the nudge we let it
      // terminate so the operator can inspect the trace rather than
      // bouncing forever.
      if (
        this._passStateGating &&
        !this._verifiedSinceUserMessage &&
        !this._gateNudgeIssued
      ) {
        this._gateNudgeIssued = true;
        // Commit the would-be-final response as the assistant turn so the
        // model's reasoning is preserved, then inject the nudge as a user
        // message and let the loop run another iteration.
        this._manager.addAssistantMessage(accumulated);
        this._manager.addUserMessage(PASS_STATE_GATING_NUDGE);
        tracer.endSpan(iterSpanId, "ok", { finalResponse: false, gateNudge: true });
        return "continue";
      }

      // No tool calls -> final response. Commit and finish.
      const msg = this._manager.addAssistantMessage(accumulated);
      postMessage({ type: "messageComplete", messageId: msg.id, renderedHtml: "" });
      this._postTokenCount(postMessage);
      if (this._compactor) {
        // v0.8.0 Phase 6.1: log a warning for non-ok states but still complete
        // the turn -- the next user message will trigger a fresh check.
        const result = await this._compactor.compact(postMessage);
        if (result.state === "rebuild-needed") {
          postMessage({
            type: "compactionStatus",
            text: `Conversation should be rebuilt: ${result.reason}`,
          });
        }
      }
      tracer.endSpan(iterSpanId, "ok", { finalResponse: true });
      return "done";
    }

    // Commit the assistant's "reasoning" turn with tool calls stripped.
    this._manager.addAssistantMessage(stripToolCalls(accumulated));

    // Execute each tool call in sequence.
    for (const parsed of parseResults) {
      if (!parsed.ok) continue; // skip malformed calls silently
      const verdict = await this._runToolCall(parsed.call, iteration, iterSpanId, tracer, postMessage);
      if (verdict === "abort") {
        tracer.endSpan(iterSpanId, "error", { reason: "tool loop terminated" });
        return "abort";
      }
    }

    // Record iteration in budget middleware.
    this._budgetMiddleware?.recordIteration();
    tracer.endSpan(iterSpanId, "ok");

    // Auto-verification + v0.7.0 Phase 7 (C34) audit/testgaps workers:
    // trigger after enough file edits. All three share the same threshold;
    // the count is reset only once they have all had a chance to fire.
    if (
      this._subAgentManager &&
      this._fileEditCount >= this._verificationThreshold &&
      (this._verificationEnabled || this._auditWorkerEnabled || this._testgapsWorkerEnabled)
    ) {
      const modifiedFiles = [...this._modifiedFiles];
      const recentToolResults = [...this._recentToolResults];
      this._fileEditCount = 0;

      if (this._verificationEnabled) {
        const verifyConfig: SubAgentConfig = {
          type: "verification",
          maxIterations: 10,
          userRequest: "Verify recent changes for correctness, check for bugs and run relevant tests.",
          modifiedFiles,
          recentToolResults,
        };
        const verifyResult = await this._subAgentManager.run(verifyConfig, postMessage);
        if (verifyResult.output) {
          this._manager.addUserMessage(`[Verification Report]\n\n${verifyResult.output}`);
        }
        this.creditSubAgentVerification(verifyResult);
      }

      if (this._auditWorkerEnabled) {
        const auditConfig: SubAgentConfig = {
          type: "audit-worker",
          maxIterations: 1,
          userRequest: "Run gemma-check on the changed files.",
          modifiedFiles,
          recentToolResults,
        };
        const auditResult = await this._subAgentManager.run(auditConfig, postMessage);
        if (auditResult.output) {
          this._manager.addUserMessage(`[Audit Report]\n\n${auditResult.output}`);
        }
        this.creditSubAgentVerification(auditResult);
      }

      if (this._testgapsWorkerEnabled) {
        const testgapsConfig: SubAgentConfig = {
          type: "testgaps-worker",
          maxIterations: 1,
          userRequest: "Run vitest --coverage on the test files matching changed source files.",
          modifiedFiles,
          recentToolResults,
        };
        const testgapsResult = await this._subAgentManager.run(testgapsConfig, postMessage);
        if (testgapsResult.output) {
          this._manager.addUserMessage(`[Test Gaps Report]\n\n${testgapsResult.output}`);
        }
        this.creditSubAgentVerification(testgapsResult);
      }

      // v1.1.0 Phase 1.7: the legacy edit-threshold curator-cadence fallback
      // has been removed. The curator now runs exclusively from the
      // `IdleTimeScheduler` (registered in the composition root) and is
      // gated by `nexus.curator.enabled` (default true).
    }

    return "continue";
  }

  /**
   * Run a single tool call: classification gating, registry execute, result
   * tracking, working/episodic memory updates, loop detection. Returns "abort"
   * when loop detection terminates the loop, otherwise "continue".
   */
  private async _runToolCall(
    call: ToolCall,
    iteration: number,
    iterSpanId: string,
    tracer: Tracer,
    postMessage: PostMessageFn,
  ): Promise<"continue" | "abort"> {
    // Action classification: check risk level before execution.
    const classification = classifyAction(call);
    postMessage({
      type: "actionClassification",
      callId: call.id,
      risk: classification.risk,
      reason: classification.reason,
    });

    if (classification.risk === ActionRisk.BLOCKED) {
      postMessage({
        type: "toolResult",
        callId: call.id,
        success: false,
        summary: `Blocked: ${classification.reason}`,
      });
      this._manager.addUserMessage(
        `[Tool ${call.tool}] Error: Action blocked for safety. ${classification.reason}`,
      );
      return "continue";
    }

    if (classification.requiresCheckpoint && this._gitSafetyNet) {
      await this._gitSafetyNet.createCheckpoint(`pre-${call.tool}`);
    }

    postMessage({ type: "toolUse", toolName: call.tool, callId: call.id });

    const toolSpanId = tracer.startSpan(
      this._traceId,
      `tool_${call.tool}`,
      "tool_call",
      iterSpanId,
      { toolName: call.tool, callId: call.id },
    );

    // v1.1.0 Phase 4.3 -- emit lifecycle.tool.pre.
    if (this._hookBus && this._sessionId) {
      this._hookBus.emit({
        kind: "lifecycle.tool.pre",
        sessionId: this._sessionId,
        toolName: call.tool,
        args: { ...call.parameters },
        parentSpanId: toolSpanId,
      });
    }
    const toolStartMs = Date.now();

    // Pass the call id to the handler via a special _callId parameter.
    const result = await this._registry.execute({
      ...call,
      parameters: { ...call.parameters, _callId: call.id },
      source: call.source ?? this._toolCallSource,
    });

    tracer.endSpan(toolSpanId, result.success ? "ok" : "error", {
      success: result.success,
    });

    // v1.1.0 Phase 4.3 -- emit lifecycle.tool.post (always) and
    // lifecycle.tool.failed (additionally on failure). The error text is
    // redacted before it hits the bus so a payload containing a leaked
    // API key, JWT, or PEM block is scrubbed at the boundary.
    if (this._hookBus && this._sessionId) {
      const toolDurationMs = Date.now() - toolStartMs;
      this._hookBus.emit({
        kind: "lifecycle.tool.post",
        sessionId: this._sessionId,
        toolName: call.tool,
        ok: result.success,
        durationMs: toolDurationMs,
        parentSpanId: toolSpanId,
      });
      if (!result.success) {
        this._hookBus.emit({
          kind: "lifecycle.tool.failed",
          sessionId: this._sessionId,
          toolName: call.tool,
          redactedError: redactSecrets(result.error ?? ""),
          parentSpanId: toolSpanId,
        });
      }
    }

    // Phase 9: append a metadata-only line to the opt-in operation log.
    // Records only tool name, outcome, optional path, and session id; tool
    // inputs (commands, file contents, search patterns) are never logged.
    if (this._operationLog && this._operationLog.isEnabled()) {
      const pathParam = call.parameters["path"];
      this._operationLog.recordToolCall({
        toolName: call.tool,
        outcome: result.success ? "ok" : "error",
        path: typeof pathParam === "string" ? pathParam : undefined,
        sessionId: this._sessionId,
      });
    }

    // v1.5.0 Phase 3 (item 3): screen inbound external-data output for indirect
    // prompt injection before it enters the agent context. Warn-then-allow --
    // flagged content is annotated, never dropped; non-inbound tools and
    // failures pass through untouched. `contextResult` carries the (possibly
    // annotated) output that the agent and the rolling result window see; the
    // real `result` still drives outcome tracking and telemetry above.
    const contextResult = await this._screenInboundResult(call, result);

    postMessage({
      type: "toolResult",
      callId: call.id,
      success: contextResult.success,
      summary: (contextResult.output || contextResult.error || "").slice(0, 200),
    });

    // Track file edits for auto-verification.
    if (FILE_EDIT_TOOLS.has(call.tool) && result.success) {
      this._fileEditCount++;
      const filePath = call.parameters["path"] as string | undefined;
      if (filePath && !this._modifiedFiles.includes(filePath)) {
        this._modifiedFiles.push(filePath);
      }
    }

    // v0.8.0 Phase 2 (item C8): a successful verification-class tool call
    // satisfies the pass-state gate. Failures do not credit the gate so
    // the agent cannot launder a failing run_terminal into a "done" claim.
    if (VERIFICATION_TOOLS.has(call.tool) && result.success) {
      this._verifiedSinceUserMessage = true;
    }

    // Update working memory based on tool results.
    if (this._workingMemory) {
      const filePath = call.parameters["path"] as string | undefined;
      if (filePath && (call.tool === "read_file" || FILE_EDIT_TOOLS.has(call.tool))) {
        this._workingMemory.addOpenFile(filePath);
      }
      if (!result.success) {
        this._workingMemory.addRecentError(
          call.tool,
          (result.error || "unknown error").slice(0, 200),
        );
      }
    }

    // Record significant tool calls to episodic memory.
    if (this._episodicMemory && this._sessionId && EPISODIC_TOOLS.has(call.tool)) {
      recordToolEvent(
        this._episodicMemory,
        this._sessionId,
        call.tool,
        call.parameters,
        result,
        `Agent iteration ${iteration + 1}`,
      ).catch(() => { /* episodic recording is non-fatal */ });
    }

    // Track recent tool results (rolling window of 5).
    const resultSummary = `[${call.tool}] ${(contextResult.output || contextResult.error || "").slice(0, 200)}`;
    this._recentToolResults.push(resultSummary);
    if (this._recentToolResults.length > MAX_RECENT_TOOL_RESULTS) {
      this._recentToolResults.shift();
    }

    // Inject the tool result back into the conversation as a user message.
    // `contextResult` is the screened/annotated form for inbound external-data
    // tools; identical to `result` for every other tool.
    const formattedResult = formatToolResult(call.tool, contextResult);
    this._manager.addUserMessage(formattedResult);

    // Loop detection: check for repetitive identical tool calls.
    if (this._loopDetector) {
      const verdict = this._loopDetector.record(call);
      if (verdict.action === "terminate") {
        postMessage({ type: "error", text: verdict.message ?? "Loop detected. Terminating." });
        return "abort";
      }
      if (verdict.action === "warn") {
        this._manager.addUserMessage(
          `[SYSTEM WARNING] ${verdict.message ?? "Repeated tool calls detected. Vary your approach."}`,
        );
      }
    }

    return "continue";
  }

  /**
   * v1.5.0 Phase 3 (item 3): route the output of inbound external-data tools
   * (`fetch_page`, `web_search`) through the inbound prompt-injection
   * classifier. Returns the original result for non-inbound tools, failures,
   * empty output, or when the classifier is disabled / unwired. When flagged,
   * returns a copy whose `output` is the warn-then-allow annotated content
   * (the full original content wrapped in an untrusted-content banner). A
   * classifier error never blocks the pillar: the original result is returned.
   */
  private async _screenInboundResult(call: ToolCall, result: ToolResult): Promise<ToolResult> {
    if (!this._inboundClassifierEnabled || !this._inboundClassifier) return result;
    if (!result.success) return result;
    if (!INBOUND_EXTERNAL_DATA_TOOLS.has(call.tool)) return result;
    if (!result.output) return result;

    try {
      const url =
        typeof call.parameters["url"] === "string"
          ? (call.parameters["url"] as string)
          : undefined;
      const screen = await this._inboundClassifier.screen(result.output, {
        tool: call.tool,
        url,
      });
      if (!screen.flagged) return result;
      return { ...result, output: screen.annotated };
    } catch (err) {
      // Never block a pillar on a classifier failure: degrade to the raw result.
      getLogger().warn(
        `[AgentLoop] inbound classifier failed for ${call.tool}; passing content through unannotated:`,
        err,
      );
      return result;
    }
  }

  private _postTokenCount(postMessage: PostMessageFn): void {
    if (!this._compactor) return;
    const count = this._compactor.estimateTokens();
    postMessage({ type: "tokenCount", count, limit: this._maxTokens });
  }

  /**
   * Stream one model turn. Returns the accumulated response text, or null if
   * the stream was aborted or encountered an error (error is posted to webview).
   */
  private async _streamOneTurn(postMessage: PostMessageFn): Promise<string | null> {
    this._abortController = new AbortController();

    // v1.5.0 Phase 5 (item 33): forward image attachments only to a
    // vision-capable model; text-only models get a clean text-only request.
    const ollamaMessages: OllamaMessage[] = toLlmMessages(
      this._manager.getHistory(),
      isVisionCapableModel(this._modelName),
    );

    postMessage({ type: "status", state: "streaming" });

    let accumulated = "";

    try {
      const stream = this._client.streamChat(
        { model: this._modelName, messages: ollamaMessages, stream: true, options: this._ollamaOptions, tools: this._tools },
        this._abortController.signal
      );

      for await (const chunk of stream) {
        if (this._cancelled) break;
        const token = chunk.message.content;
        if (token) {
          postMessage({ type: "token", value: token });
          accumulated += token;
        }
      }

      return this._cancelled ? null : accumulated;
    } catch (err) {
      if (this._abortController.signal.aborted) {
        return null; // normal cancellation — no error message
      }
      const message = formatForUser(err);
      postMessage({ type: "error", text: `Stream error: ${message}` });
      return null;
    } finally {
      this._abortController = null;
    }
  }
}
