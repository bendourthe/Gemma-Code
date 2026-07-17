// ---------------------------------------------------------------------------
// v1.12.0 Phase 2 (adoption-ecosystem-2026-07 EM.P2.A) -- the sidecar manager
// backing the two-call skill-optimizer approval flow.
//
// The sidecar transport is one-shot request/response with no server-push
// channel, so the interactive human-approval-before-overwrite cannot happen
// mid-`optimize()`. Instead the app makes two calls:
//
//   skills.optimize.preview -> runs the optimizer with a CAPTURING DENY gate
//     (proposes + gate-clears edits, writes NOTHING), stores the captured
//     proposals under a fresh session token, and returns them for review.
//   skills.optimize.apply   -> { token, proposalId } writes the EXACT previewed
//     bytes for that proposal via a path-guarded io.
//
// Approval binds to the precise previewed content (the app never re-runs the
// optimizer to apply), so the human approves the same edit that is written --
// the load-bearing guardrail. The optimizer run itself is an injected seam
// (`SkillOptimizePreviewRunner`) so this manager is testable without Ollama; the
// production runner (bottom) composes the real optimizer + local backend.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { IpcMethodError } from "../protocol.js";
import {
  CapturingApprovalGate,
  createHeadlessSkillOptimizer,
  type CapturedSkillEdit,
} from "../../../../modules/coding/skilloptimizer/HeadlessOptimizerFactory.js";
import { RootSkillPathResolver, fsSkillFileIO } from "../../../../modules/coding/skilloptimizer/io.js";
import { loadOptimizerVisibleTasks } from "../../../../modules/coding/evaluation/goldenSplit.js";
import { ArtifactStore } from "../../../../core/memory/ArtifactStore.js";
import { RejectedEditBuffer } from "../../../../core/memory/RejectedEditBuffer.js";
import type { LLMClient } from "../../../../modules/coding/llm/types.js";

export interface SkillOptimizePreviewParams {
  readonly skillId: string;
  readonly model?: string;
  readonly maxRounds?: number;
}

export interface SkillOptimizeProposal {
  readonly id: string;
  readonly skillId: string;
  readonly skillPath: string;
  readonly diff: string;
}

export interface SkillOptimizePreviewResult {
  readonly token: string;
  readonly proposals: readonly SkillOptimizeProposal[];
}

export interface SkillOptimizeApplyParams {
  readonly token: string;
  readonly proposalId: string;
}

export interface SkillOptimizeApplyResult {
  readonly applied: boolean;
  readonly skillId: string;
  readonly skillPath: string;
}

/** Runs the optimizer with a capturing gate; returns the captured (denied) proposals. Injected so the manager is testable without a live model. */
export interface SkillOptimizePreviewRunner {
  run(params: SkillOptimizePreviewParams): Promise<readonly CapturedSkillEdit[]>;
}

interface StoredProposal extends CapturedSkillEdit {
  readonly id: string;
}

export interface SkillOptimizerManagerOptions {
  /** The preview runner. When omitted, `preview` fails clearly (unconfigured context). */
  readonly runner?: SkillOptimizePreviewRunner;
  readonly idFactory?: () => string;
  /** Overridable for tests; production path-guards then writes via fsSkillFileIO. */
  readonly write?: (path: string, content: string) => void;
}

const unconfiguredRunner: SkillOptimizePreviewRunner = {
  run: async () => {
    throw new IpcMethodError("skills.optimize.preview", "skill optimizer runner is not configured");
  },
};

/** Path-guard `path` inside its own directory (defense in depth; it was already guarded at capture) and write. */
function guardedWrite(path: string, content: string): void {
  const resolved = new RootSkillPathResolver(dirname(path)).resolve(path);
  fsSkillFileIO.write(resolved, content);
}

export class SkillOptimizerManager {
  private readonly _sessions = new Map<string, StoredProposal[]>();
  private readonly _runner: SkillOptimizePreviewRunner;
  private readonly _idFactory: () => string;
  private readonly _write: (path: string, content: string) => void;

  constructor(opts: SkillOptimizerManagerOptions = {}) {
    this._runner = opts.runner ?? unconfiguredRunner;
    this._idFactory = opts.idFactory ?? (() => randomUUID());
    this._write = opts.write ?? guardedWrite;
  }

  async preview(params: SkillOptimizePreviewParams): Promise<SkillOptimizePreviewResult> {
    const captured = await this._runner.run(params);
    const token = this._idFactory();
    const stored: StoredProposal[] = captured.map((c, i) => ({ ...c, id: String(i) }));
    this._sessions.set(token, stored);
    return {
      token,
      proposals: stored.map((p) => ({
        id: p.id,
        skillId: p.skillId,
        skillPath: p.skillPath,
        diff: p.diff,
      })),
    };
  }

  async apply(params: SkillOptimizeApplyParams): Promise<SkillOptimizeApplyResult> {
    const stored = this._sessions.get(params.token);
    if (!stored) {
      throw new IpcMethodError("skills.optimize.apply", `unknown token: ${params.token}`);
    }
    const proposal = stored.find((p) => p.id === params.proposalId);
    if (!proposal) {
      throw new IpcMethodError("skills.optimize.apply", `unknown proposalId: ${params.proposalId}`);
    }
    if (!proposal.newContent) {
      throw new IpcMethodError("skills.optimize.apply", "proposal has no write-ready content");
    }
    this._write(proposal.skillPath, proposal.newContent);
    return { applied: true, skillId: proposal.skillId, skillPath: proposal.skillPath };
  }
}

// ---------------------------------------------------------------------------
// Production preview runner.
//
// Composes the real optimizer (createHeadlessSkillOptimizer + CapturingApprovalGate)
// over the local Ollama backend. NOTE: its live path (a real rollout against
// Ollama + on-disk skill/golden resolution) is verified only with the running
// app + a local model -- it is not exercised by the sidecar unit tests, which
// inject a fake runner. Skill resolution assumes the Nexus-Hub catalog layout
// `<catalogSkillsDir>/<name>/SKILL.md`; an unresolvable skill throws (surfaced
// to the app). See docs/v1/v1.12/known-gaps.md EM.P2.A.
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ProductionPreviewRunnerOptions {
  readonly llm: LLMClient;
  readonly defaultModel: string;
  readonly snapshotRoot: string;
  readonly tasksDir: string;
  readonly artifactsDir: string;
  /** Resolve a skill id to its on-disk SKILL.md absolute path. */
  readonly resolveSkillPath: (skillId: string) => string;
  /** Read a file (injected for testability); defaults to fsSkillFileIO.read. */
  readonly readFile?: (path: string) => string;
}

/** Build the production preview runner: run the real optimizer with a capturing gate and return its proposals. */
export function createHeadlessOptimizePreviewRunner(
  options: ProductionPreviewRunnerOptions,
): SkillOptimizePreviewRunner {
  const readFile = options.readFile ?? ((p: string) => fsSkillFileIO.read(p));
  return {
    async run(params: SkillOptimizePreviewParams): Promise<readonly CapturedSkillEdit[]> {
      const skillPath = options.resolveSkillPath(params.skillId);
      const raw = readFile(skillPath);
      const match = FRONTMATTER_RE.exec(raw);
      const body = (match?.[2] ?? raw).trim();
      const target = {
        id: params.skillId,
        displayName: params.skillId,
        path: skillPath,
        provenance: { source: "nexus-hub" as const, contentHash: "" },
        frontmatter: {},
        body,
      };

      const visible = loadOptimizerVisibleTasks(options.tasksDir);
      const train = visible.filter((t) => t.split === "train");
      const validation = visible.filter((t) => t.split === "validation");

      const gate = new CapturingApprovalGate();
      const store = new ArtifactStore(options.artifactsDir);
      const buffer = new RejectedEditBuffer(store, `${options.artifactsDir}/rejected-index.json`);
      const optimizer = createHeadlessSkillOptimizer({
        llm: options.llm,
        model: params.model ?? options.defaultModel,
        snapshotRoot: options.snapshotRoot,
        catalogRoot: dirname(skillPath),
        buffer,
        approvalGate: gate,
        config: {
          maxRounds: params.maxRounds ?? 3,
          learningRate: { maxOps: 3, maxChangedChars: 400 },
        },
      });

      // The `target` shape matches the `Skill` the optimizer consumes; the cast
      // keeps this file free of the core/skills import surface.
      await optimizer.optimize({
        target: target as unknown as Parameters<typeof optimizer.optimize>[0]["target"],
        train,
        validation,
      });
      return gate.captured;
    },
  };
}
