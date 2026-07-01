// ---------------------------------------------------------------------------
// v1.7.0 Phase 4 (adoption-self-optimizing-skills S3 / SO005) -- the default,
// vscode-free branch-worktree materializer for candidate isolation.
//
// `WorktreeCandidateManager` reuses the v1.5.0 worktree-swarm pattern: it
// materializes each candidate on its OWN git branch inside a throwaway worktree
// checked out from HEAD, commits the candidate skill body there (so the ephemeral
// worktree is left clean and can be auto-removed while the branch ref survives for
// a later, approved merge), and removes the worktree on cleanup.
//
// It drives git through the SAME injectable `GitRunner` contract the
// `WorktreeManager` exposes (imported as a type only, so no runtime dependency on
// that vscode-coupled module's logger is pulled in -- the optimizer subtree stays
// plain-Node loadable, the invariant Phase 1 / Phase 3 established). Every op is
// fault-tolerant (resolves to null/false, never throws) exactly like
// `WorktreeManager` / `GitSafetyNet`, so a git-less or non-repo environment simply
// disables isolation. A composition root that already lives inside the vscode
// host may instead inject a `CandidateWorkspaceManager` backed by the concrete
// `WorktreeManager` + `GitSafetyNet` behind the same seam.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { GitRunner } from "../agents/WorktreeManager.js";
import { fsSkillFileIO } from "./io.js";
import { reassembleSkillFile } from "./skillEdit.js";
import type {
  CandidateWorkspace,
  CandidateWorkspaceManager,
  SkillCandidate,
  SkillFileIO,
} from "./types.js";

/** Reduce an arbitrary string to a safe git ref / directory segment. */
function sanitizeRef(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, 60) || "candidate";
}

/**
 * A {@link CandidateWorkspaceManager} that materializes each candidate on its own
 * git branch in an isolated worktree, using an injected {@link GitRunner}.
 */
export class WorktreeCandidateManager implements CandidateWorkspaceManager {
  private _counter = 0;

  constructor(
    private readonly _workspaceRoot: string,
    /** Path of the skill file to overwrite, relative to a worktree root. */
    private readonly _skillRelPath: string,
    private readonly _git: GitRunner,
    private readonly _io: SkillFileIO = fsSkillFileIO,
    private readonly _baseDir: string = path.join(os.tmpdir(), "nexus-skill-candidates"),
  ) {}

  /**
   * Create a branch-worktree for the candidate, materialize its body, and commit
   * it on the branch. Returns null (isolation unavailable) when the workspace is
   * not a git repo, git is unavailable, or any step fails -- always fail-closed.
   */
  async create(candidate: SkillCandidate): Promise<CandidateWorkspace | null> {
    const inside = await this._git(["rev-parse", "--is-inside-work-tree"], this._workspaceRoot);
    if (inside === null || inside.trim() !== "true") return null;

    const safeId = sanitizeRef(candidate.id);
    const branch = `nexus/skill-candidate/${sanitizeRef(candidate.skillId)}/${safeId}`;
    const dir = path.join(this._baseDir, `${safeId}-${process.pid}-${++this._counter}`);

    try {
      fs.mkdirSync(this._baseDir, { recursive: true });
    } catch {
      return null;
    }

    // Create a NEW branch at HEAD checked out in the throwaway worktree, so the
    // candidate never touches the live branch.
    const added = await this._git(
      ["worktree", "add", "-b", branch, dir, "HEAD"],
      this._workspaceRoot,
    );
    if (added === null) return null;

    // Materialize the candidate body into the worktree's skill file (frontmatter
    // preserved when the file already exists in the snapshot).
    const target = path.join(dir, this._skillRelPath);
    try {
      const original = this._io.read(target);
      this._io.write(target, reassembleSkillFile(original, candidate.body));
    } catch {
      this._io.write(target, candidate.body);
    }

    // Commit on the branch so the worktree is clean (auto-removable) and the
    // candidate survives on its branch ref.
    await this._git(["add", "--", this._skillRelPath], dir);
    const committed = await this._git(
      ["commit", "-m", `[nexus] skill candidate ${candidate.id}`, "--no-verify"],
      dir,
    );
    if (committed === null) {
      await this._removeWorktree(dir);
      return null;
    }

    return { candidateId: candidate.id, branch, path: dir };
  }

  /**
   * Remove the ephemeral worktree if it is clean (a committed candidate leaves it
   * clean). Retains a dirty worktree (returns false) so nothing is lost. The
   * branch ref is never deleted here -- it is kept for a possible promotion.
   */
  async cleanup(workspace: CandidateWorkspace): Promise<boolean> {
    const status = await this._git(["status", "--porcelain"], workspace.path);
    if (status === null) return false;
    if (status.trim().length > 0) return false;
    return this._removeWorktree(workspace.path);
  }

  private async _removeWorktree(dir: string): Promise<boolean> {
    const removed = await this._git(["worktree", "remove", "--force", dir], this._workspaceRoot);
    return removed !== null;
  }
}
