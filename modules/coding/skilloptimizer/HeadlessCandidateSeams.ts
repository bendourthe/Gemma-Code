// ---------------------------------------------------------------------------
// v1.7.0 SO005.P4.A / SO005.P4.B -- production CandidateFrontier seams.
//
// Wires the three deferred frontier seams over the real substrate:
//  - HeadlessCandidateProducer (P4.A): turns per-minibatch diagnoses into >= 2
//    diverse candidate bodies via the real SkillEditProposer + applySkillEditOps.
//  - HeadlessCandidateScorer (P4.A): scores a candidate across the diverse task
//    set via the OptimizerRollout (candidate body as a skill override), yielding
//    the Pareto per-task vector + the held-out aggregate.
//  - HeadlessCandidatePromoter (P4.B): merges an APPROVED candidate body into the
//    live skill catalog (frontmatter preserved), behind an optional GitSafetyNet
//    checkpoint. Fail-closed. Reachable only after the frontier's human-approval
//    gate (the no-auto-merge guarantee is structural in CandidateFrontier).
//
// All vscode-free; every collaborator is injected (the CandidateFrontier already
// owns the population/Pareto/replacement/approval logic -- these only supply the
// produce/score/promote work it fans out to).
// ---------------------------------------------------------------------------

import type { GoldenTaskSpec } from "../evaluation/goldenTaskLoader.js";
import { applySkillEditOps, hashSkillEdit, reassembleSkillFile } from "./skillEdit.js";
import type {
  CandidateProducer,
  CandidatePromoter,
  CandidateScore,
  CandidateScorer,
  CandidateWorkspace,
  LearningRateBudget,
  OptimizerRollout,
  PerTaskScores,
  SkillCandidate,
  SkillEditProposer,
  SkillFileIO,
} from "./types.js";

// --- Producer (SO005.P4.A) -------------------------------------------------

export interface HeadlessCandidateProducerOptions {
  readonly proposer: SkillEditProposer;
  readonly skillId: string;
  /** The current skill body (markdown after the frontmatter) each edit builds on. */
  readonly baseBody: string;
  /**
   * One redacted failure diagnosis per candidate slot. The composition root
   * derives these from varied failing-trajectory minibatches (the "seeds" that
   * make the produced candidates diverse); each yields at most one candidate.
   */
  readonly diagnoses: readonly string[];
  readonly budget: LearningRateBudget;
}

/**
 * Produces candidate skill bodies by proposing one bounded edit per diagnosis
 * and applying it to the base body. Null proposals are skipped (fail-closed:
 * no edit beats a bad edit) and identical bodies are de-duplicated, so the
 * frontier only ever ranks distinct variants.
 */
export class HeadlessCandidateProducer implements CandidateProducer {
  constructor(private readonly _opts: HeadlessCandidateProducerOptions) {}

  async produce(): Promise<readonly SkillCandidate[]> {
    const seen = new Set<string>();
    const candidates: SkillCandidate[] = [];
    for (const diagnosis of this._opts.diagnoses) {
      const edit = await this._opts.proposer.propose({
        skillId: this._opts.skillId,
        skillBody: this._opts.baseBody,
        diagnosis,
        budget: this._opts.budget,
      });
      if (!edit) continue;
      const body = applySkillEditOps(this._opts.baseBody, edit.ops);
      if (body === this._opts.baseBody) continue; // no-op edit
      const id = hashSkillEdit(edit);
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push({ id, skillId: this._opts.skillId, body, label: edit.rationale });
    }
    return candidates;
  }
}

// --- Scorer (SO005.P4.A) ---------------------------------------------------

export interface HeadlessCandidateScorerOptions {
  readonly rollout: OptimizerRollout;
  /** The diverse task set every candidate is scored across (the Pareto axes). */
  readonly tasks: readonly GoldenTaskSpec[];
  /** Which task ids form the held-out (validation) aggregate. */
  readonly heldOutTaskIds: ReadonlySet<string>;
}

/**
 * Scores a candidate by running the rollout over the diverse task set with the
 * candidate body as a skill override. Each task becomes a Pareto axis (1 pass /
 * 0 fail); the held-out aggregate is the pass-rate over the held-out subset.
 * Scoring uses the body override (deterministic), so it does not require the
 * branch workspace -- that isolation matters for promotion, not measurement.
 */
export class HeadlessCandidateScorer implements CandidateScorer {
  constructor(private readonly _opts: HeadlessCandidateScorerOptions) {}

  async score(candidate: SkillCandidate, _workspace: CandidateWorkspace | null): Promise<CandidateScore> {
    const results = await this._opts.rollout.run(this._opts.tasks, {
      skillId: candidate.skillId,
      body: candidate.body,
    });
    const perTask: Record<string, number> = {};
    let heldPass = 0;
    let heldTotal = 0;
    for (const r of results) {
      perTask[r.taskId] = r.passed ? 1 : 0;
      if (this._opts.heldOutTaskIds.has(r.taskId)) {
        heldTotal += 1;
        if (r.passed) heldPass += 1;
      }
    }
    const heldOut = heldTotal === 0 ? 0 : heldPass / heldTotal;
    return { candidateId: candidate.id, perTask: perTask as PerTaskScores, heldOut };
  }
}

// --- Promoter (SO005.P4.B) -------------------------------------------------

export interface HeadlessCandidatePromoterOptions {
  readonly io: SkillFileIO;
  /** Map a skill id to its fail-closed-resolved catalog file path. */
  readonly skillPathFor: (skillId: string) => string;
  /** Optional pre-write checkpoint (GitSafetyNet); return false to abort promotion. */
  readonly checkpoint?: () => Promise<boolean>;
}

/**
 * Merges an APPROVED candidate body into the live skill catalog. Reads the
 * current skill file, reassembles it with the candidate body (frontmatter
 * preserved), and writes it back, behind an optional checkpoint. Fail-closed:
 * any error (path resolution, missing file, aborted checkpoint) returns false
 * and writes nothing. The CandidateFrontier only ever calls this after its
 * human-approval gate, so this is never an auto-merge.
 */
export class HeadlessCandidatePromoter implements CandidatePromoter {
  constructor(private readonly _opts: HeadlessCandidatePromoterOptions) {}

  async promote(candidate: SkillCandidate, _workspace: CandidateWorkspace | null): Promise<boolean> {
    try {
      if (this._opts.checkpoint) {
        const ok = await this._opts.checkpoint();
        if (!ok) return false;
      }
      const filePath = this._opts.skillPathFor(candidate.skillId);
      const original = this._opts.io.read(filePath);
      const merged = reassembleSkillFile(original, candidate.body);
      this._opts.io.write(filePath, merged);
      return true;
    } catch {
      return false;
    }
  }
}
