import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { EpisodicEntry } from "./MemoryLayers.types.js";
import { getLogger } from "../../modules/coding/utils/logger.js";

/**
 * v0.8.0 Phase 6.3 (item A9) -- Reflect job.
 *
 * Nightly consolidation of session memories into durable lessons. Walks
 * the last 24h of episodic memory, clusters events by action similarity,
 * and for each cluster of >=3 events generates a one-paragraph lesson
 * that is appended to `Memory.md` under a `## Reflected Lessons` section.
 *
 * The job is intentionally split into `dryRun()` and `apply()` so the
 * operator can review proposed lessons before any file is touched. Each
 * applied manifest writes a `*-rollback.json` companion so `rollback()`
 * can re-remove the appended block.
 *
 * Triggered once per VSCode-idle day when hardware tier is `balanced` or
 * `full`. On `constrained` tiers the lesson-generation call is skipped
 * and the manifest contains the cluster descriptions only (no lessons).
 */

export interface ReflectCluster {
  readonly actionKey: string;
  readonly events: readonly EpisodicEntry[];
  readonly occurrences: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
}

export interface ReflectLesson {
  readonly id: string;
  readonly actionKey: string;
  readonly clusterSize: number;
  readonly lesson: string;
  readonly generatedAt: number;
}

export interface ReflectManifest {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly lookbackMs: number;
  readonly clusters: readonly ReflectCluster[];
  readonly lessons: readonly ReflectLesson[];
  readonly hardwareTier: HardwareTier;
  readonly manifestPath: string;
}

export interface ReflectApplyResult {
  readonly rollbackId: string;
  readonly rollbackPath: string;
  readonly lessonsAppended: number;
  readonly memoryFilePath: string;
}

export interface ReflectRollbackResult {
  readonly lessonsReverted: number;
}

export type HardwareTier = "constrained" | "balanced" | "full";

/** Auxiliary callback used to summarize a cluster into a one-paragraph lesson. */
export type LessonGenerator = (cluster: ReflectCluster) => Promise<string>;

export interface ReflectJobOptions {
  readonly manifestDir: string;
  readonly memoryFilePath: string;
  readonly lookbackMs?: number;
  readonly minClusterSize?: number;
  readonly hardwareTier?: HardwareTier;
  readonly now?: () => number;
}

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_CLUSTER_SIZE = 3;
const REFLECTED_LESSONS_HEADER = "## Reflected Lessons";

/**
 * Listing shape the job needs from the episodic store. We accept any
 * implementation that can return events in a time window so tests can
 * inject deterministic fixtures without spinning up the real SQLite layer.
 */
export interface EpisodicReader {
  listSince(sinceMs: number): readonly EpisodicEntry[];
}

export class ReflectJob {
  private readonly _reader: EpisodicReader;
  private readonly _lessonGenerator: LessonGenerator | null;
  private readonly _opts: Required<Omit<ReflectJobOptions, "hardwareTier">> & {
    hardwareTier: HardwareTier;
  };
  private _lastDryRunId: string | null = null;
  private _lastAppliedId: string | null = null;

  constructor(
    reader: EpisodicReader,
    lessonGenerator: LessonGenerator | null,
    options: ReflectJobOptions,
  ) {
    this._reader = reader;
    this._lessonGenerator = lessonGenerator;
    this._opts = {
      manifestDir: options.manifestDir,
      memoryFilePath: options.memoryFilePath,
      lookbackMs: options.lookbackMs ?? DEFAULT_LOOKBACK_MS,
      minClusterSize: options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE,
      hardwareTier: options.hardwareTier ?? "balanced",
      now: options.now ?? Date.now,
    };
  }

  /**
   * Walk the last `lookbackMs` of episodic memory, cluster by action key,
   * generate lessons for qualifying clusters, and write a manifest to disk.
   * No edits to `Memory.md` happen here -- the operator confirms via
   * `apply(manifestId)`.
   */
  async dryRun(): Promise<ReflectManifest> {
    const now = this._opts.now();
    const sinceMs = now - this._opts.lookbackMs;
    const events = this._reader.listSince(sinceMs);
    const clusters = this._cluster(events).filter(
      (c) => c.occurrences >= this._opts.minClusterSize,
    );

    const lessons: ReflectLesson[] = [];
    if (
      this._lessonGenerator !== null &&
      this._opts.hardwareTier !== "constrained"
    ) {
      for (const cluster of clusters) {
        const text = await this._lessonGenerator(cluster);
        lessons.push({
          id: randomUUID(),
          actionKey: cluster.actionKey,
          clusterSize: cluster.occurrences,
          lesson: text.trim(),
          generatedAt: now,
        });
      }
    }

    const id = randomUUID();
    fs.mkdirSync(this._opts.manifestDir, { recursive: true });
    const manifestPath = path.join(this._opts.manifestDir, `${id}.json`);
    const manifest: ReflectManifest = {
      version: 1,
      id,
      createdAt: new Date(now).toISOString(),
      lookbackMs: this._opts.lookbackMs,
      clusters,
      lessons,
      hardwareTier: this._opts.hardwareTier,
      manifestPath,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    this._lastDryRunId = id;
    return manifest;
  }

  /**
   * Apply a previously-produced dry-run manifest. Appends each lesson to
   * `Memory.md` under the `## Reflected Lessons` section (creating the
   * section if missing). Writes a rollback companion that can restore the
   * pre-apply file bytes.
   */
  async apply(manifestId: string): Promise<ReflectApplyResult> {
    const manifestPath = path.join(this._opts.manifestDir, `${manifestId}.json`);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest not found: ${manifestPath}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ReflectManifest;
    if (manifest.lessons.length === 0) {
      return {
        rollbackId: "",
        rollbackPath: "",
        lessonsAppended: 0,
        memoryFilePath: this._opts.memoryFilePath,
      };
    }

    const memoryPath = this._opts.memoryFilePath;
    const previousBytes = fs.existsSync(memoryPath)
      ? fs.readFileSync(memoryPath, "utf-8")
      : "";

    const updated = this._appendLessons(previousBytes, manifest.lessons);
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, updated, "utf-8");

    const rollbackId = randomUUID();
    const rollbackPath = path.join(this._opts.manifestDir, `${rollbackId}-rollback.json`);
    fs.writeFileSync(
      rollbackPath,
      JSON.stringify(
        {
          version: 1,
          id: rollbackId,
          appliedManifestId: manifest.id,
          memoryFilePath: memoryPath,
          previousBytes,
        },
        null,
        2,
      ),
    );

    this._lastAppliedId = manifest.id;
    return {
      rollbackId,
      rollbackPath,
      lessonsAppended: manifest.lessons.length,
      memoryFilePath: memoryPath,
    };
  }

  async rollback(rollbackId: string): Promise<ReflectRollbackResult> {
    const rollbackPath = path.join(this._opts.manifestDir, `${rollbackId}-rollback.json`);
    if (!fs.existsSync(rollbackPath)) {
      throw new Error(`Rollback manifest not found: ${rollbackPath}`);
    }
    const rollback = JSON.parse(fs.readFileSync(rollbackPath, "utf-8")) as {
      memoryFilePath: string;
      previousBytes: string;
    };
    fs.writeFileSync(rollback.memoryFilePath, rollback.previousBytes, "utf-8");
    return { lessonsReverted: 1 };
  }

  get lastDryRunId(): string | null {
    return this._lastDryRunId;
  }

  get lastAppliedId(): string | null {
    return this._lastAppliedId;
  }

  private _cluster(events: readonly EpisodicEntry[]): ReflectCluster[] {
    const buckets = new Map<string, EpisodicEntry[]>();
    for (const ev of events) {
      const key = this._actionKey(ev);
      const list = buckets.get(key) ?? [];
      list.push(ev);
      buckets.set(key, list);
    }
    const clusters: ReflectCluster[] = [];
    for (const [actionKey, list] of buckets) {
      if (list.length === 0) continue;
      const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (!first || !last) continue;
      clusters.push({
        actionKey,
        events: sorted,
        occurrences: sorted.length,
        firstSeen: first.timestamp,
        lastSeen: last.timestamp,
      });
    }
    return clusters.sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Cluster key: normalized action verb plus first 40 chars of the context.
   * Crude but deterministic; suitable for the lesson-summarization step.
   */
  private _actionKey(event: EpisodicEntry): string {
    const action = (event.action ?? "").toLowerCase().trim().split(/\s+/)[0] ?? "";
    const ctxHead = (event.context ?? "").trim().slice(0, 40);
    return `${action}::${ctxHead}`;
  }

  private _appendLessons(previous: string, lessons: readonly ReflectLesson[]): string {
    const tail = lessons
      .map(
        (l) =>
          `- **${new Date(l.generatedAt).toISOString().slice(0, 10)}** (${l.actionKey}, ${l.clusterSize} events): ${l.lesson}`,
      )
      .join("\n");

    if (previous.includes(REFLECTED_LESSONS_HEADER)) {
      return `${previous.replace(/\s*$/, "")}\n${tail}\n`;
    }
    const sep = previous.length === 0 || previous.endsWith("\n") ? "" : "\n";
    return `${previous}${sep}\n${REFLECTED_LESSONS_HEADER}\n\n${tail}\n`;
  }
}

export function shouldRunReflectJob(tier: HardwareTier): boolean {
  return tier === "balanced" || tier === "full";
}

export function reflectLogger(): ReturnType<typeof getLogger> {
  return getLogger();
}
