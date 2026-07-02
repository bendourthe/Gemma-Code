// ---------------------------------------------------------------------------
// v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- default,
// vscode-free implementations of the skill-write guardrail seams.
//
// `RootSkillPathResolver` is a containment check that mirrors
// `pathGuard.resolveInsideWorkspace` (realpath + boundary) WITHOUT importing the
// vscode-coupled `pathGuard` -- so the optimizer module stays vscode-free. The
// composition root may instead inject a `SkillPathResolver` that delegates to
// the real `pathGuard.resolveInsideWorkspace(p, catalogRoot)`; both enforce the
// same guarantee (a skill edit can only ever touch a file inside the catalog
// root, fail-closed on traversal).
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillFileIO, SkillPathResolver } from "./types.js";

/** Real-path a path through its nearest existing ancestor (handles non-existent leaves). */
function realThroughAncestor(absolute: string): string {
  let current = absolute;
  const tail: string[] = [];
  // Walk up until an existing ancestor is found, then realpath it.
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute; // reached the root without resolving
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves skill paths against a fixed catalog root and refuses anything that
 * escapes it. Throws on a path-traversal attempt (fail-closed).
 */
export class RootSkillPathResolver implements SkillPathResolver {
  private readonly _rootReal: string;

  constructor(catalogRoot: string) {
    this._rootReal = realThroughAncestor(path.resolve(catalogRoot));
  }

  resolve(skillPath: string): string {
    const absolute = path.isAbsolute(skillPath)
      ? skillPath
      : path.resolve(this._rootReal, skillPath);
    const real = realThroughAncestor(absolute);
    if (real !== this._rootReal && !real.startsWith(this._rootReal + path.sep)) {
      throw new Error(
        `Skill path "${skillPath}" resolves outside the skill catalog root "${this._rootReal}".`,
      );
    }
    return real;
  }
}

/** A {@link SkillFileIO} backed by the real filesystem. */
export const fsSkillFileIO: SkillFileIO = {
  read(p: string): string {
    return fs.readFileSync(p, "utf8");
  },
  write(p: string, content: string): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, p);
  },
};
