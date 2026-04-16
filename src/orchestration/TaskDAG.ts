/**
 * TaskDAG -- Directed Acyclic Graph of subtasks for Plan-and-Execute orchestration.
 *
 * Provides dependency-aware task scheduling, cycle detection via Kahn's algorithm,
 * failure propagation (skipDependents), and serialization for persistence/transport.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskNodeType = "research" | "code" | "test" | "verify";
export type TaskNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface TaskNode {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly type: TaskNodeType;
  readonly dependencies: readonly string[];
  readonly maxRetries: number;
  status: TaskNodeStatus;
  result?: string;
  error?: string;
  retryCount: number;
}

export interface DAGProgress {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly pending: number;
  readonly running: number;
}

/** Serializable representation of a TaskDAG. */
export interface SerializedDAG {
  readonly nodes: TaskNode[];
}

// ---------------------------------------------------------------------------
// TaskDAG
// ---------------------------------------------------------------------------

export class TaskDAG {
  private readonly _nodes: Map<string, TaskNode>;
  /** Reverse adjacency: nodeId -> set of IDs that depend on it. */
  private _dependents: Map<string, Set<string>>;

  constructor(nodes: TaskNode[] = []) {
    this._nodes = new Map();
    this._dependents = new Map();

    for (const node of nodes) {
      if (this._nodes.has(node.id)) {
        throw new Error(`Duplicate node ID: "${node.id}"`);
      }
      this._nodes.set(node.id, { ...node });
    }

    // Validate all dependency references exist.
    for (const node of this._nodes.values()) {
      for (const dep of node.dependencies) {
        if (!this._nodes.has(dep)) {
          throw new Error(
            `Node "${node.id}" depends on unknown node "${dep}"`,
          );
        }
      }
    }

    this._buildDependentsMap();

    if (this.hasCycle()) {
      throw new Error("TaskDAG contains a cycle");
    }
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  addNode(node: TaskNode): void {
    if (this._nodes.has(node.id)) {
      throw new Error(`Duplicate node ID: "${node.id}"`);
    }
    for (const dep of node.dependencies) {
      if (!this._nodes.has(dep)) {
        throw new Error(
          `Node "${node.id}" depends on unknown node "${dep}"`,
        );
      }
    }

    this._nodes.set(node.id, { ...node });
    this._buildDependentsMap();

    if (this.hasCycle()) {
      // Roll back.
      this._nodes.delete(node.id);
      this._buildDependentsMap();
      throw new Error(
        `Adding node "${node.id}" would create a cycle`,
      );
    }
  }

  markRunning(nodeId: string): void {
    const node = this._getNode(nodeId);
    node.status = "running";
  }

  markCompleted(nodeId: string, result: string): void {
    const node = this._getNode(nodeId);
    node.status = "completed";
    node.result = result;
  }

  markFailed(nodeId: string, error: string): void {
    const node = this._getNode(nodeId);
    node.error = error;
    node.retryCount++;
    if (node.retryCount < node.maxRetries) {
      node.status = "pending";
    } else {
      node.status = "failed";
    }
  }

  /**
   * Recursively mark all transitive dependents of the given node as "skipped".
   */
  skipDependents(nodeId: string): void {
    const visited = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const deps = this._dependents.get(current);
      if (!deps) continue;

      for (const depId of deps) {
        if (visited.has(depId)) continue;
        visited.add(depId);
        const depNode = this._nodes.get(depId)!;
        if (depNode.status !== "completed") {
          depNode.status = "skipped";
        }
        queue.push(depId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getNode(nodeId: string): TaskNode | undefined {
    return this._nodes.get(nodeId);
  }

  /**
   * Returns nodes whose status is "pending" and all dependencies are "completed".
   */
  getReadyNodes(): TaskNode[] {
    const ready: TaskNode[] = [];
    for (const node of this._nodes.values()) {
      if (node.status !== "pending") continue;
      const allDepsCompleted = node.dependencies.every((depId) => {
        const dep = this._nodes.get(depId);
        return dep?.status === "completed";
      });
      if (allDepsCompleted) {
        ready.push(node);
      }
    }
    return ready;
  }

  isComplete(): boolean {
    for (const node of this._nodes.values()) {
      if (node.status !== "completed" && node.status !== "skipped") {
        return false;
      }
    }
    return true;
  }

  /**
   * Cycle detection using Kahn's algorithm (topological sort).
   * Returns true if the graph contains at least one cycle.
   */
  hasCycle(): boolean {
    const inDegree = new Map<string, number>();
    for (const id of this._nodes.keys()) {
      inDegree.set(id, 0);
    }
    for (const node of this._nodes.values()) {
      for (const dep of node.dependencies) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0));
        // dep -> node edge: increment node's in-degree is wrong.
        // Actually: node depends on dep means edge dep -> node.
        // In-degree of node increases for each dependency.
      }
    }
    // Recompute correctly: in-degree[nodeId] = number of dependencies.
    for (const node of this._nodes.values()) {
      inDegree.set(node.id, node.dependencies.length);
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    let processed = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      processed++;
      const deps = this._dependents.get(current);
      if (!deps) continue;
      for (const depId of deps) {
        const newDegree = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, newDegree);
        if (newDegree === 0) queue.push(depId);
      }
    }

    return processed !== this._nodes.size;
  }

  getProgress(): DAGProgress {
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let pending = 0;
    let running = 0;

    for (const node of this._nodes.values()) {
      switch (node.status) {
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
        case "skipped":
          skipped++;
          break;
        case "pending":
          pending++;
          break;
        case "running":
          running++;
          break;
      }
    }

    return {
      total: this._nodes.size,
      completed,
      failed,
      skipped,
      pending,
      running,
    };
  }

  getNodes(): TaskNode[] {
    return [...this._nodes.values()];
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  toJSON(): SerializedDAG {
    return { nodes: [...this._nodes.values()] };
  }

  static fromJSON(json: SerializedDAG): TaskDAG {
    return new TaskDAG(json.nodes);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _getNode(nodeId: string): TaskNode {
    const node = this._nodes.get(nodeId);
    if (!node) {
      throw new Error(`Unknown node ID: "${nodeId}"`);
    }
    return node;
  }

  private _buildDependentsMap(): void {
    this._dependents = new Map();
    for (const id of this._nodes.keys()) {
      this._dependents.set(id, new Set());
    }
    for (const node of this._nodes.values()) {
      for (const dep of node.dependencies) {
        this._dependents.get(dep)?.add(node.id);
      }
    }
  }
}
