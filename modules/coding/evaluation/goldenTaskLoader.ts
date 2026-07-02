// ---------------------------------------------------------------------------
// v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- loader for the
// YAML golden-task corpus under `tests/golden/tasks/`.
//
// TS-native port of `tests/golden/framework/task_loader.py` + `models.py`. The
// YAML harness uses a different, larger schema than the in-process
// `GOLDEN_TASKS` smoke set (`GoldenTaskSuite.ts`), so this module defines a
// distinct `GoldenTaskSpec` and a focused, dependency-free parser for the
// fixed subset of YAML the corpus uses.
//
// Why a hand-rolled parser instead of `js-yaml`: the project deliberately
// avoids a YAML runtime dependency (see `scripts/generate-golden-tasks.mjs`,
// which regex-extracts the `id` for the same reason, and the
// `parseSkillFrontmatter` subset parser in `bin/nexus.mjs`). The golden tasks
// are authored to one fixed, documented schema (`tests/golden/README.md`), so
// a targeted parser covering exactly those constructs -- top-level scalars, a
// `|` block scalar, block sequences, mapping sequences, and flow lists, with
// single/double-quoted scalar decoding -- is sufficient and is validated
// against the full corpus in the unit tests. Unsupported constructs throw
// (fail-closed) rather than silently mis-parsing.
//
// Boundary: vscode-free, no outbound, no logging.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import type { GoldenCriterionType, GoldenSuccessCriterion } from "./goldenCriteria.js";

const KNOWN_CRITERION_TYPES: ReadonlySet<string> = new Set<GoldenCriterionType>([
  "file_contains",
  "file_exists",
  "file_deleted",
  "test_passes",
  "lint_passes",
  "diff_matches",
  "output_contains",
  "no_errors",
]);

/**
 * v1.7.0 Phase 2 (S4 / SO002) -- the held-out dataset split a task belongs to.
 * `train` is rolled out by the optimizer, `validation` is the held-out gate the
 * optimizer may read, and `test` is the contamination-guarded split the
 * optimizer code path must never see (enforced in `goldenSplit.ts`).
 */
export type GoldenSplit = "train" | "validation" | "test";

const KNOWN_SPLITS: ReadonlySet<string> = new Set<GoldenSplit>(["train", "validation", "test"]);

/**
 * A golden task as declared in a `tests/golden/tasks/*.yaml` file. Distinct
 * from the in-process `GoldenTask` (`GoldenTaskSuite.ts`): this is the
 * out-of-process harness schema the live runner executes.
 */
export interface GoldenTaskSpec {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** Natural-language prompt handed to the agent. */
  readonly description: string;
  /** Snapshot path relative to the corpus root, e.g. `snapshots/<id>`. */
  readonly initialState: string;
  readonly expectedFilesChanged: readonly string[];
  readonly successCriteria: readonly GoldenSuccessCriterion[];
  readonly maxIterations: number;
  readonly timeoutSeconds: number;
  readonly modelTier: string;
  readonly tags: readonly string[];
  /**
   * v1.7.0 Phase 2 (S4 / SO002) -- the dataset split this task belongs to.
   * Optional in the YAML: when absent, a deterministic default is assigned by
   * category in `goldenSplit.ts` (`assignDefaultSplits`) so every split stays
   * representative. Present here only when a task pins its split explicitly.
   */
  readonly split?: GoldenSplit;
}

// ---------------------------------------------------------------------------
// Minimal YAML-subset parser
// ---------------------------------------------------------------------------

type YamlValue = string | string[] | Array<Record<string, string>>;

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return t.length === 0 || t.startsWith("#");
}

/** Split `key: value` into its key and (possibly empty) raw value. */
function splitKeyValue(line: string): { key: string; rest: string } {
  const idx = line.indexOf(":");
  if (idx === -1) {
    throw new Error(`Malformed YAML line (expected 'key: value'): ${JSON.stringify(line)}`);
  }
  return { key: line.slice(0, idx).trim(), rest: line.slice(idx + 1).trim() };
}

/** Decode a YAML double-quoted scalar (handles \\, \", \n, \t, \r, \/, \0). */
function parseDoubleQuoted(s: string): string {
  let out = "";
  let i = 1; // skip opening quote
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const next = s[i + 1] ?? "";
      switch (next) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case '"': out += '"'; break;
        case "\\": out += "\\"; break;
        case "/": out += "/"; break;
        case "0": out += "\0"; break;
        default: out += next; break;
      }
      i += 2;
      continue;
    }
    if (c === '"') return out; // closing quote; ignore any trailing comment
    out += c;
    i++;
  }
  return out; // tolerate an unterminated quote
}

/** Decode a YAML single-quoted scalar (only `''` -> `'`). */
function parseSingleQuoted(s: string): string {
  let out = "";
  let i = 1; // skip opening quote
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return out; // closing quote
    }
    out += c;
    i++;
  }
  return out;
}

/** Parse a scalar value (plain / single-quoted / double-quoted). */
function parseScalar(raw: string): string {
  const s = raw.trim();
  if (s.length === 0) return "";
  if (s.startsWith('"')) return parseDoubleQuoted(s);
  if (s.startsWith("'")) return parseSingleQuoted(s);
  return s;
}

/** Parse an inline flow list `[a, b, c]`. */
function parseFlowList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((item) => parseScalar(item));
}

/**
 * Collect a `|` literal block scalar starting at `start`. Returns the joined
 * block (common indentation stripped, trailing blank lines clipped) and the
 * index of the first line that is no longer part of the block.
 */
function collectBlockScalar(lines: readonly string[], start: number): { value: string; next: number } {
  let j = start;
  while (j < lines.length && lines[j]!.trim() === "") j++;
  if (j >= lines.length) return { value: "", next: j };
  const blockIndent = leadingSpaces(lines[j]!);
  const collected: string[] = [];
  let i = j;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      collected.push("");
      i++;
      continue;
    }
    if (leadingSpaces(line) < blockIndent) break;
    collected.push(line.slice(blockIndent));
    i++;
  }
  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
  return { value: collected.join("\n"), next: i };
}

/** True when a sequence item's content (after `- `) is itself a `key: value`. */
function looksLikeMappingEntry(afterDash: string): boolean {
  const idx = afterDash.indexOf(":");
  if (idx === -1) return false;
  // A bare scalar containing a colon (e.g. a URL) would false-positive, but the
  // golden schema's scalar sequence (expected_files_changed) holds only paths.
  return /^[A-Za-z0-9_]+\s*:/.test(afterDash);
}

/**
 * Parse a block sequence beginning at `start`. Items are either bare scalars
 * (`- src/foo.ts`) or single-line mappings (`- type: x` + indented `key: val`
 * continuation lines). Returns the items and the next unconsumed line index.
 */
function parseSequence(lines: readonly string[], start: number): { items: YamlValue; next: number } {
  const baseIndent = leadingSpaces(lines[start]!);
  const scalars: string[] = [];
  const maps: Array<Record<string, string>> = [];
  let sawMapping = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlankOrComment(line)) {
      i++;
      continue;
    }
    const indent = leadingSpaces(line);
    if (indent < baseIndent) break;
    const trimmed = line.trimStart();
    if (indent !== baseIndent || !trimmed.startsWith("- ")) break;

    const afterDash = trimmed.slice(2).trim();
    if (looksLikeMappingEntry(afterDash)) {
      sawMapping = true;
      const entry: Record<string, string> = {};
      const { key, rest } = splitKeyValue(afterDash);
      entry[key] = parseScalar(rest);
      i++;
      // Continuation lines belong to this item while indented deeper than the dash.
      while (i < lines.length) {
        const contLine = lines[i]!;
        if (isBlankOrComment(contLine)) {
          i++;
          continue;
        }
        if (leadingSpaces(contLine) <= baseIndent) break;
        const { key: ck, rest: cr } = splitKeyValue(contLine.trim());
        entry[ck] = parseScalar(cr);
        i++;
      }
      maps.push(entry);
    } else {
      scalars.push(parseScalar(afterDash));
      i++;
    }
  }

  return { items: sawMapping ? maps : scalars, next: i };
}

/**
 * Parse the fixed golden-task YAML subset into a flat record. Top-level keys
 * map to a scalar, a string list, or a list of `{key: value}` mappings
 * (success_criteria).
 */
export function parseGoldenTaskYaml(text: string): Record<string, YamlValue> {
  const lines = text.split(/\r?\n/);
  const root: Record<string, YamlValue> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlankOrComment(line)) {
      i++;
      continue;
    }
    if (leadingSpaces(line) !== 0) {
      // A stray indented line at top level is unexpected for this schema.
      throw new Error(`Unexpected indentation at top level: ${JSON.stringify(line)}`);
    }

    const { key, rest } = splitKeyValue(line);

    if (rest === "|" || rest === "|-" || rest === "|+") {
      const { value, next } = collectBlockScalar(lines, i + 1);
      root[key] = value;
      i = next;
      continue;
    }
    if (rest.startsWith(">")) {
      throw new Error(`Unsupported folded block scalar '>' for key '${key}'`);
    }
    if (rest === "") {
      // A nested block sequence follows (expected_files_changed / success_criteria).
      const { items, next } = parseSequence(lines, i + 1);
      root[key] = items;
      i = next;
      continue;
    }
    if (rest.startsWith("[")) {
      root[key] = parseFlowList(rest);
      i++;
      continue;
    }
    root[key] = parseScalar(rest);
    i++;
  }

  return root;
}

// ---------------------------------------------------------------------------
// Spec construction + validation
// ---------------------------------------------------------------------------

function requireString(root: Record<string, YamlValue>, key: string, file: string): string {
  const v = root[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${file}: missing or empty required field '${key}'`);
  }
  return v;
}

function optionalString(root: Record<string, YamlValue>, key: string, fallback: string): string {
  const v = root[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function optionalInt(root: Record<string, YamlValue>, key: string, fallback: number): number {
  const v = root[key];
  if (typeof v !== "string") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse the optional `split` field. Absent -> `undefined` (defaulted later by
 * category). Present but not one of the three known splits -> throw
 * (fail-closed, matching the loader's discipline for unknown constructs).
 */
function optionalSplit(root: Record<string, YamlValue>, key: string, file: string): GoldenSplit | undefined {
  const v = root[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !KNOWN_SPLITS.has(v)) {
    throw new Error(`${file}: '${key}' must be one of train|validation|test, got ${JSON.stringify(v)}`);
  }
  return v as GoldenSplit;
}

function stringList(value: YamlValue | undefined): string[] {
  if (Array.isArray(value) && value.every((x) => typeof x === "string")) {
    return value as string[];
  }
  return [];
}

function parseCriteria(value: YamlValue | undefined, file: string): GoldenSuccessCriterion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((x) => typeof x === "string")) {
    throw new Error(`${file}: 'success_criteria' must be a list of mappings`);
  }
  const raw = value as Array<Record<string, string>>;
  return raw.map((item, idx) => {
    const type = item["type"];
    if (type === undefined || !KNOWN_CRITERION_TYPES.has(type)) {
      throw new Error(`${file}: success_criteria[${idx}] has unknown type '${String(type)}'`);
    }
    return {
      type: type as GoldenCriterionType,
      target: item["target"] ?? "",
      pattern: item["pattern"] ?? "",
      description: item["description"] ?? "",
    };
  });
}

/** Build a validated {@link GoldenTaskSpec} from parsed YAML. */
export function toGoldenTaskSpec(root: Record<string, YamlValue>, sourceLabel = "<task>"): GoldenTaskSpec {
  return {
    id: requireString(root, "id", sourceLabel),
    name: requireString(root, "name", sourceLabel),
    category: requireString(root, "category", sourceLabel),
    description: requireString(root, "description", sourceLabel),
    initialState: requireString(root, "initial_state", sourceLabel),
    expectedFilesChanged: stringList(root["expected_files_changed"]),
    successCriteria: parseCriteria(root["success_criteria"], sourceLabel),
    maxIterations: optionalInt(root, "max_iterations", 20),
    timeoutSeconds: optionalInt(root, "timeout_seconds", 300),
    modelTier: optionalString(root, "model_tier", "any"),
    tags: stringList(root["tags"]),
    split: optionalSplit(root, "split", sourceLabel),
  };
}

/** Load and validate a single golden-task YAML file. */
export function loadGoldenTask(yamlPath: string): GoldenTaskSpec {
  const text = fs.readFileSync(yamlPath, "utf8");
  return toGoldenTaskSpec(parseGoldenTaskYaml(text), path.basename(yamlPath));
}

/**
 * Load every `*.yaml` task in a directory (skipping files whose name starts
 * with `_`), sorted by filename for determinism.
 */
export function loadAllGoldenTasks(tasksDir: string): GoldenTaskSpec[] {
  if (!fs.existsSync(tasksDir) || !fs.statSync(tasksDir).isDirectory()) {
    throw new Error(`Golden task directory not found: ${tasksDir}`);
  }
  return fs
    .readdirSync(tasksDir)
    .filter((name) => name.endsWith(".yaml") && !name.startsWith("_"))
    .sort()
    .map((name) => loadGoldenTask(path.join(tasksDir, name)));
}
