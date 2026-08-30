import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { nexusHome } from "../storage/paths.js";
import type { WorkspaceScope } from "./WorkspaceScope.js";

interface WorkspaceFile {
  readonly version: 1;
  readonly workspaces: readonly WorkspaceScope[];
}

export function defaultWorkspaceStorePath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), "workspaces.json");
}

export class WorkspaceScopeStore {
  private readonly scopes = new Map<string, WorkspaceScope>();

  constructor(private readonly filePath: string = defaultWorkspaceStorePath()) {
    if (!existsSync(filePath)) return;
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as WorkspaceFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) {
      throw new Error("Workspace store is malformed");
    }
    for (const scope of parsed.workspaces) {
      if (!scope?.workspaceId || !Array.isArray(scope.workspaceRoots)) {
        throw new Error("Workspace store contains a malformed workspace");
      }
      this.scopes.set(scope.workspaceId, Object.freeze({ ...scope }));
    }
  }

  get(workspaceId: string): WorkspaceScope | undefined {
    return this.scopes.get(workspaceId);
  }

  list(): readonly WorkspaceScope[] {
    return [...this.scopes.values()].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  upsert(scope: WorkspaceScope): WorkspaceScope {
    const existing = this.scopes.get(scope.workspaceId);
    const stored = Object.freeze({
      ...scope,
      createdAt: existing?.createdAt ?? scope.createdAt,
      workspaceRoots: Object.freeze([...scope.workspaceRoots]),
      identityRoots: Object.freeze([...scope.identityRoots]),
    });
    this.scopes.set(stored.workspaceId, stored);
    this.persist();
    return stored;
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: WorkspaceFile = { version: 1, workspaces: [...this.scopes.values()] };
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(temp, this.filePath);
  }
}
