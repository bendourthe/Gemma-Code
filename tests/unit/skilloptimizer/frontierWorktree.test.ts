import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorktreeCandidateManager } from "../../../modules/coding/skilloptimizer/frontierWorktree.js";
import type { GitRunner } from "../../../modules/coding/agents/WorktreeManager.js";
import type { SkillCandidate, SkillFileIO } from "../../../modules/coding/skilloptimizer/types.js";

/**
 * v1.7.0 Phase 4 (adoption-self-optimizing-skills S3 / SO005) -- unit tests for
 * the default branch-worktree materializer, git driven by an injected fake
 * `GitRunner` (no real git). Proves: a candidate is materialized on its own
 * branch and committed (frontmatter preserved); the manager fails closed to null
 * when git is unavailable or any step fails; a failed commit removes the
 * half-made worktree; and cleanup removes only a clean worktree.
 */

const SKILL_REL = path.join("catalog", "skill-x", "SKILL.md");
const FRONTMATTER = "---\nname: skill-x\nversion: 1.0.0\n---\n";
const ORIGINAL = FRONTMATTER + "old body\n";

function candidate(id = "c1"): SkillCandidate {
  return { id, skillId: "skill-x", body: "new candidate body\n", label: "edit" };
}

type Handler = (args: readonly string[], cwd: string) => string | null;

function makeGit(handler: Handler): { git: GitRunner; calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const git: GitRunner = async (args, cwd) => {
    calls.push({ args: [...args], cwd });
    return handler(args, cwd);
  };
  return { git, calls };
}

/** Happy-path git: inside a repo, every command succeeds, a clean worktree. */
function happyGit(): Handler {
  return (args) => {
    const key = args.join(" ");
    if (key === "rev-parse --is-inside-work-tree") return "true\n";
    if (key === "status --porcelain") return "";
    return ""; // worktree add / add / commit / worktree remove all succeed
  };
}

function readingIo(content: string | null): SkillFileIO & { writes: Array<{ path: string; content: string }> } {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    read: (p) => {
      if (content === null) throw new Error(`no such file: ${p}`);
      return content;
    },
    write: (p, c) => {
      writes.push({ path: p, content: c });
    },
  };
}

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-frontier-test-"));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("WorktreeCandidateManager.create", () => {
  it("materializes the candidate on its own branch and commits it (frontmatter preserved)", async () => {
    const { git, calls } = makeGit(happyGit());
    const io = readingIo(ORIGINAL);
    const mgr = new WorktreeCandidateManager("/repo", SKILL_REL, git, io, baseDir);

    const workspace = await mgr.create(candidate("c1"));

    expect(workspace).not.toBeNull();
    expect(workspace!.candidateId).toBe("c1");
    expect(workspace!.branch).toBe("nexus/skill-candidate/skill-x/c1");
    // The worktree was added on a NEW branch checked out from HEAD.
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add");
    expect(addCall!.args).toEqual(["worktree", "add", "-b", workspace!.branch, workspace!.path, "HEAD"]);
    // The candidate body was written with the frontmatter preserved.
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]!.content).toBe(FRONTMATTER + "new candidate body\n");
    expect(io.writes[0]!.path).toContain("SKILL.md");
    // It was committed on the branch (so the worktree is left clean).
    expect(calls.some((c) => c.args[0] === "commit")).toBe(true);
  });

  it("writes the body directly when the skill file is absent in the snapshot", async () => {
    const { git } = makeGit(happyGit());
    const io = readingIo(null); // read throws -> no frontmatter to preserve
    const mgr = new WorktreeCandidateManager("/repo", SKILL_REL, git, io, baseDir);

    await mgr.create(candidate());

    expect(io.writes[0]!.content).toBe("new candidate body\n");
  });

  it("fails closed to null when the workspace is not a git repo", async () => {
    const { git, calls } = makeGit((args) =>
      args.join(" ") === "rev-parse --is-inside-work-tree" ? "false\n" : "",
    );
    const mgr = new WorktreeCandidateManager("/repo", SKILL_REL, git, readingIo(ORIGINAL), baseDir);

    expect(await mgr.create(candidate())).toBeNull();
    expect(calls.some((c) => c.args[0] === "worktree")).toBe(false); // never attempted an add
  });

  it("fails closed to null when the worktree add fails", async () => {
    const { git } = makeGit((args) => {
      const key = args.join(" ");
      if (key === "rev-parse --is-inside-work-tree") return "true\n";
      if (args[0] === "worktree" && args[1] === "add") return null; // add failed
      return "";
    });
    const mgr = new WorktreeCandidateManager("/repo", SKILL_REL, git, readingIo(ORIGINAL), baseDir);

    expect(await mgr.create(candidate())).toBeNull();
  });

  it("removes the half-made worktree and returns null when the commit fails", async () => {
    const { git, calls } = makeGit((args) => {
      const key = args.join(" ");
      if (key === "rev-parse --is-inside-work-tree") return "true\n";
      if (args[0] === "commit") return null; // commit failed
      return "";
    });
    const mgr = new WorktreeCandidateManager("/repo", SKILL_REL, git, readingIo(ORIGINAL), baseDir);

    expect(await mgr.create(candidate())).toBeNull();
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(true);
  });
});

describe("WorktreeCandidateManager.cleanup", () => {
  const workspace = { candidateId: "c1", branch: "nexus/skill-candidate/skill-x/c1", path: "/wt/c1" };

  it("removes a clean worktree (the branch ref survives)", async () => {
    const { git, calls } = makeGit(happyGit());
    const mgr = new WorktreeCandidateManager("/repo", SKILL_REL, git, readingIo(ORIGINAL), baseDir);

    expect(await mgr.cleanup(workspace)).toBe(true);
    const removeCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "remove");
    expect(removeCall!.args).toEqual(["worktree", "remove", "--force", "/wt/c1"]);
  });

  it("retains a dirty worktree (returns false, no removal)", async () => {
    const { git, calls } = makeGit((args) =>
      args.join(" ") === "status --porcelain" ? " M catalog/skill-x/SKILL.md\n" : "",
    );
    const mgr = new WorktreeCandidateManager("/repo", SKILL_REL, git, readingIo(ORIGINAL), baseDir);

    expect(await mgr.cleanup(workspace)).toBe(false);
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("returns false when the status check fails", async () => {
    const { git } = makeGit((args) => (args.join(" ") === "status --porcelain" ? null : ""));
    const mgr = new WorktreeCandidateManager("/repo", SKILL_REL, git, readingIo(ORIGINAL), baseDir);

    expect(await mgr.cleanup(workspace)).toBe(false);
  });
});
