/**
 * v2.0.0 Phase 4.6 -- substrate-behind-interface seams.
 *
 * Typed facades over session store, sandbox, and memory. Current
 * implementations sit behind these aliases. No behavior change.
 */

import type { MemoryHub } from "../memory/MemoryHub.js";
import type { ProjectScope } from "./ProjectScope.js";

export type MemorySeam = MemoryHub;

export interface SessionStoreSeam<TSession = { readonly id: string }> {
  get(id: string): TSession | undefined;
  list(): readonly TSession[];
}

export interface SandboxSeam {
  readonly projectId: string;
  readonly root: string;
  reset(): Promise<void>;
}

export interface ProjectSubstrate {
  readonly scope: ProjectScope;
  readonly memory: MemorySeam;
  readonly sessions: SessionStoreSeam;
  readonly sandbox: SandboxSeam;
}
