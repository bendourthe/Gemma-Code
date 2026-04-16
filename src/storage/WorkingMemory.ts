import type { WorkingMemoryState } from "./MemoryLayers.types.js";

const MAX_OPEN_FILES = 10;
const MAX_RECENT_ERRORS = 5;
const MAX_DECISIONS = 5;
const CHARS_PER_TOKEN = 4;

/**
 * Layer 1: ephemeral in-context working memory.
 *
 * Tracks the agent's current task state as a lightweight JSON object that
 * is serialized directly into the system prompt. Not persisted to disk;
 * exists only for the duration of the current session.
 */
export class WorkingMemory {
  private _state: WorkingMemoryState = {
    currentTask: null,
    openFiles: [],
    recentErrors: [],
    architecturalDecisions: [],
    activeGoals: [],
    scratchpad: {},
  };

  setCurrentTask(task: string | null): void {
    this._state.currentTask = task;
  }

  addOpenFile(filePath: string): void {
    if (this._state.openFiles.includes(filePath)) return;
    this._state.openFiles.push(filePath);
    if (this._state.openFiles.length > MAX_OPEN_FILES) {
      this._state.openFiles.shift();
    }
  }

  removeOpenFile(filePath: string): void {
    const idx = this._state.openFiles.indexOf(filePath);
    if (idx !== -1) {
      this._state.openFiles.splice(idx, 1);
    }
  }

  addRecentError(file: string, error: string): void {
    this._state.recentErrors.push({ file, error, timestamp: Date.now() });
    if (this._state.recentErrors.length > MAX_RECENT_ERRORS) {
      this._state.recentErrors.shift();
    }
  }

  addDecision(decision: string, rationale: string): void {
    this._state.architecturalDecisions.push({
      decision,
      rationale,
      timestamp: Date.now(),
    });
    if (this._state.architecturalDecisions.length > MAX_DECISIONS) {
      this._state.architecturalDecisions.shift();
    }
  }

  setActiveGoals(goals: string[]): void {
    this._state.activeGoals = [...goals];
  }

  setScratchpad(key: string, value: unknown): void {
    this._state.scratchpad[key] = value;
  }

  getScratchpad(key: string): unknown {
    return this._state.scratchpad[key];
  }

  getState(): Readonly<WorkingMemoryState> {
    return this._state;
  }

  /**
   * Serialize to compact markdown for injection into the system prompt.
   * If the serialized form exceeds maxTokens (estimated at chars/4),
   * truncate least-important sections (scratchpad first, then goals,
   * then errors).
   */
  serialize(maxTokens: number): string {
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    const parts: Array<{ key: string; text: string; priority: number }> = [];

    if (this._state.currentTask) {
      parts.push({
        key: "task",
        text: `**Task**: ${this._state.currentTask}`,
        priority: 0,
      });
    }

    if (this._state.openFiles.length > 0) {
      parts.push({
        key: "files",
        text: `**Open files**: ${this._state.openFiles.join(", ")}`,
        priority: 1,
      });
    }

    if (this._state.architecturalDecisions.length > 0) {
      const decisionLines = this._state.architecturalDecisions
        .map((d) => `- ${d.decision} (${d.rationale})`)
        .join("\n");
      parts.push({
        key: "decisions",
        text: `**Decisions**:\n${decisionLines}`,
        priority: 2,
      });
    }

    if (this._state.recentErrors.length > 0) {
      const errorLines = this._state.recentErrors
        .map((e) => `- ${e.file}: ${e.error}`)
        .join("\n");
      parts.push({
        key: "errors",
        text: `**Recent errors**:\n${errorLines}`,
        priority: 3,
      });
    }

    if (this._state.activeGoals.length > 0) {
      const goalLines = this._state.activeGoals.map((g) => `- ${g}`).join("\n");
      parts.push({
        key: "goals",
        text: `**Goals**:\n${goalLines}`,
        priority: 4,
      });
    }

    const scratchpadKeys = Object.keys(this._state.scratchpad);
    if (scratchpadKeys.length > 0) {
      const scratchpadLines = scratchpadKeys
        .map((k) => `- ${k}: ${JSON.stringify(this._state.scratchpad[k])}`)
        .join("\n");
      parts.push({
        key: "scratchpad",
        text: `**Scratchpad**:\n${scratchpadLines}`,
        priority: 5,
      });
    }

    if (parts.length === 0) return "";

    // Sort by priority ascending (most important first).
    parts.sort((a, b) => a.priority - b.priority);

    const header = "## Working Memory\n\n";
    let result = header;

    for (const part of parts) {
      const candidate = result + part.text + "\n";
      if (candidate.length > maxChars) break;
      result = candidate;
    }

    return result.trimEnd();
  }

  clear(): void {
    this._state = {
      currentTask: null,
      openFiles: [],
      recentErrors: [],
      architecturalDecisions: [],
      activeGoals: [],
      scratchpad: {},
    };
  }

  toJSON(): string {
    return JSON.stringify(this._state);
  }
}

export function createWorkingMemory(): WorkingMemory {
  return new WorkingMemory();
}
