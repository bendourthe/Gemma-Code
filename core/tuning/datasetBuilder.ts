/**
 * v2.1.0 Phase 5 -- local dataset builder. Every record passes redactSecrets.
 * Unreadable or oversized sources are skipped; the rest of the dataset continues.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { redactSecrets } from "../observability/redactSecrets.js";
import { nexusHome } from "../storage/paths.js";

export interface ChatTurn {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface DatasetRecord {
  readonly messages: readonly ChatTurn[];
}

export interface SkipReport {
  readonly path: string;
  readonly reason: string;
}

export interface DatasetBuildResult {
  readonly id: string;
  readonly outputPath: string;
  readonly written: number;
  readonly redacted: number;
  readonly skipped: readonly SkipReport[];
  readonly preview: readonly DatasetRecord[];
}

export interface DatasetBuildOptions {
  readonly sources: readonly string[];
  readonly id?: string;
  readonly maxBytes?: number;
  readonly previewLimit?: number;
  readonly homeDirFn?: () => string;
  readonly now?: () => Date;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export function extractRecordsFromText(text: string, sourcePath: string): DatasetRecord[] {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith(".jsonl")) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseJsonRecord(line))
      .filter((row): row is DatasetRecord => row !== null);
  }
  if (lower.endsWith(".json")) {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((row) => normalizeUnknown(row))
        .filter((row): row is DatasetRecord => row !== null);
    }
    const one = normalizeUnknown(parsed);
    return one ? [one] : [];
  }
  if (lower.endsWith(".csv")) {
    return parseCsv(text);
  }
  return [{ messages: [{ role: "user", content: text }] }];
}

function parseJsonRecord(line: string): DatasetRecord | null {
  try {
    return normalizeUnknown(JSON.parse(line));
  } catch {
    return { messages: [{ role: "user", content: line }] };
  }
}

function normalizeUnknown(value: unknown): DatasetRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.messages)) {
    const messages = row.messages
      .map((m) => {
        if (!m || typeof m !== "object") return null;
        const msg = m as Record<string, unknown>;
        const role = msg.role === "system" || msg.role === "assistant" ? msg.role : "user";
        const content = typeof msg.content === "string" ? msg.content : "";
        return { role, content } as ChatTurn;
      })
      .filter((m): m is ChatTurn => m !== null);
    return messages.length > 0 ? { messages } : null;
  }
  const instruction = typeof row.instruction === "string" ? row.instruction : typeof row.prompt === "string" ? row.prompt : "";
  const output = typeof row.output === "string" ? row.output : typeof row.completion === "string" ? row.completion : "";
  if (!instruction && !output) return null;
  const messages: ChatTurn[] = [];
  if (instruction) messages.push({ role: "user", content: instruction });
  if (output) messages.push({ role: "assistant", content: output });
  return { messages };
}

function parseCsv(text: string): DatasetRecord[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = (lines[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
  const promptIdx = header.findIndex((h) => h === "prompt" || h === "instruction");
  const completionIdx = header.findIndex((h) => h === "completion" || h === "output");
  if (promptIdx < 0) return [];
  const out: DatasetRecord[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const instruction = (cols[promptIdx] ?? "").trim();
    const output = completionIdx >= 0 ? (cols[completionIdx] ?? "").trim() : "";
    if (!instruction) continue;
    const messages: ChatTurn[] = [{ role: "user", content: instruction }];
    if (output) messages.push({ role: "assistant", content: output });
    out.push({ messages });
  }
  return out;
}

function redactRecord(record: DatasetRecord): { record: DatasetRecord; redacted: boolean } {
  let redacted = false;
  const messages = record.messages.map((m) => {
    const content = redactSecrets(m.content);
    if (content !== m.content) redacted = true;
    return { ...m, content };
  });
  return { record: { messages }, redacted };
}

function collectFiles(source: string, acc: string[]): void {
  let st;
  try {
    st = statSync(source);
  } catch {
    return;
  }
  if (st.isFile()) {
    acc.push(source);
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of readdirSync(source)) {
    collectFiles(path.join(source, name), acc);
  }
}

export function buildDataset(opts: DatasetBuildOptions): DatasetBuildResult {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const id = opts.id ?? `ds-${(opts.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, "-")}`;
  const files: string[] = [];
  for (const source of opts.sources) collectFiles(source, files);
  const skipped: SkipReport[] = [];
  const kept: DatasetRecord[] = [];
  let redacted = 0;
  for (const file of files) {
    const lower = file.toLowerCase();
    if (lower.endsWith(".pdf")) {
      skipped.push({ path: file, reason: "PDF extractor is not wired in this cycle; skip and continue." });
      continue;
    }
    let st;
    try {
      st = statSync(file);
    } catch {
      skipped.push({ path: file, reason: "unreadable" });
      continue;
    }
    if (st.size > maxBytes) {
      skipped.push({ path: file, reason: `oversized (${st.size} bytes > ${maxBytes})` });
      continue;
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      skipped.push({ path: file, reason: "unreadable" });
      continue;
    }
    let records: DatasetRecord[];
    try {
      records = extractRecordsFromText(text, file);
    } catch {
      skipped.push({ path: file, reason: "parse error" });
      continue;
    }
    for (const rec of records) {
      const next = redactRecord(rec);
      if (next.redacted) redacted += 1;
      kept.push(next.record);
    }
  }
  const root = path.join(nexusHome(opts.homeDirFn), "tuning", "datasets", id);
  mkdirSync(root, { recursive: true });
  const outputPath = path.join(root, "train.jsonl");
  writeFileSync(outputPath, kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length > 0 ? "\n" : ""));
  const previewLimit = opts.previewLimit ?? 5;
  return {
    id,
    outputPath,
    written: kept.length,
    redacted,
    skipped,
    preview: kept.slice(0, previewLimit),
  };
}
