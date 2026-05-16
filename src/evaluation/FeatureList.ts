import * as fs from "fs";
import * as path from "path";

/**
 * v0.8.0 Phase 2 (item C1) -- machine-readable scope contract for the cycle.
 *
 * `feature_list.json` lives at the repository root and lists every feature
 * Gemma Code ships. Each row carries an id, a human-readable name and
 * description, a status (`not_started` / `active` / `blocked` / `passing`),
 * an evidence pointer (a path or shell command), an ISO `testedAt` stamp,
 * and a `verificationCommand` that the operator can run to re-verify the
 * row.
 *
 * The golden task suite stamps rows as `passing` when the matching golden
 * task succeeds, so the contract self-updates as the cycle progresses. The
 * loader is intentionally permissive on read (extra fields pass through)
 * but strict on `validate()` so a malformed contract fails CI rather than
 * silently drift.
 */

export type FeatureStatus =
  | "not_started"
  | "active"
  | "blocked"
  | "passing";

export interface FeatureRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  status: FeatureStatus;
  readonly evidence: string;
  testedAt: string | null;
  readonly verificationCommand: string;
}

export interface FeatureList {
  version: string;
  features: FeatureRow[];
}

export interface ValidationIssue {
  readonly index: number;
  readonly id: string;
  readonly field: string;
  readonly message: string;
}

const VALID_STATUSES: readonly FeatureStatus[] = [
  "not_started",
  "active",
  "blocked",
  "passing",
];

const SEMVER_RE = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const ID_RE = /^f\d{3,}$/;

/**
 * Default path: `<repoRoot>/feature_list.json`. Callers pass their own
 * absolute path in tests so fixtures are not coupled to cwd.
 */
export function defaultFeatureListPath(repoRoot: string): string {
  return path.join(repoRoot, "feature_list.json");
}

export function loadFeatureList(filePath: string): FeatureList {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isPlainObject(parsed) || !Array.isArray(parsed["features"])) {
    throw new Error(
      `Invalid feature list at ${filePath}: expected an object with a "features" array.`,
    );
  }
  const version = typeof parsed["version"] === "string" ? parsed["version"] : "";
  const features = (parsed["features"] as unknown[]).map((row, idx) => {
    if (!isPlainObject(row)) {
      throw new Error(`Invalid feature list row at index ${idx}: not an object.`);
    }
    return {
      id: stringField(row, "id"),
      name: stringField(row, "name"),
      description: stringField(row, "description"),
      status: (stringField(row, "status") || "not_started") as FeatureStatus,
      evidence: stringField(row, "evidence"),
      testedAt: row["testedAt"] === null ? null : stringField(row, "testedAt") || null,
      verificationCommand: stringField(row, "verificationCommand"),
    } satisfies FeatureRow;
  });
  return { version, features };
}

export function saveFeatureList(filePath: string, list: FeatureList): void {
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2) + "\n", "utf8");
}

/**
 * Validate the in-memory feature list against the v0.8.0 schema. Returns an
 * array of issues -- empty when the list is well-formed.
 */
export function validate(list: FeatureList): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!SEMVER_RE.test(list.version)) {
    issues.push({
      index: -1,
      id: "(top)",
      field: "version",
      message: `Expected "vMAJOR.MINOR.PATCH" semver; got "${list.version}".`,
    });
  }

  const seen = new Set<string>();
  for (let i = 0; i < list.features.length; i++) {
    const row = list.features[i]!;
    if (!ID_RE.test(row.id)) {
      issues.push({
        index: i,
        id: row.id,
        field: "id",
        message: `Expected "fNNN" id (e.g. "f014"); got "${row.id}".`,
      });
    }
    if (seen.has(row.id)) {
      issues.push({
        index: i,
        id: row.id,
        field: "id",
        message: `Duplicate id.`,
      });
    }
    seen.add(row.id);
    if (!row.name) issues.push(issue(i, row.id, "name", "must be non-empty"));
    if (!row.description) issues.push(issue(i, row.id, "description", "must be non-empty"));
    if (!VALID_STATUSES.includes(row.status)) {
      issues.push(
        issue(
          i,
          row.id,
          "status",
          `expected one of ${VALID_STATUSES.join("|")}; got "${row.status}"`,
        ),
      );
    }
    if (!row.evidence) issues.push(issue(i, row.id, "evidence", "must be non-empty"));
    if (!row.verificationCommand) {
      issues.push(issue(i, row.id, "verificationCommand", "must be non-empty"));
    }
    if (row.testedAt !== null && !isIsoDateString(row.testedAt)) {
      issues.push(
        issue(
          i,
          row.id,
          "testedAt",
          `expected ISO-8601 date or null; got "${row.testedAt}"`,
        ),
      );
    }
  }
  return issues;
}

/**
 * Flip the matching feature row to `passing` and stamp `testedAt`. Returns
 * `true` when a row was updated, `false` when the id is unknown.
 *
 * `evidence` is intentionally not overwritten: it documents the artifact
 * path and is authored manually so the file remains an authoritative scope
 * contract rather than a generated dump.
 */
export function markPassing(
  list: FeatureList,
  id: string,
  options: { now?: Date } = {},
): boolean {
  const row = list.features.find((f) => f.id === id);
  if (!row) return false;
  const stamp = (options.now ?? new Date()).toISOString().slice(0, 10);
  row.status = "passing";
  row.testedAt = stamp;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function issue(
  index: number,
  id: string,
  field: string,
  message: string,
): ValidationIssue {
  return { index, id, field, message };
}

function isIsoDateString(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.Z+\-]+)?$/.test(text)) return false;
  const date = new Date(text);
  return !Number.isNaN(date.getTime());
}
