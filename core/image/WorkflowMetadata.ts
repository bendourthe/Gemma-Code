/**
 * v1.0.0 Phase 6.6 -- PNG `tEXt` chunk embed/extract for Nexus workflow JSON.
 *
 * Reverse-engineered from the ComfyUI pattern of writing a "workflow"
 * `tEXt` chunk that carries the full generation request. Nexus writes
 * under the key `nexus_workflow` AND a compatibility alias `workflow`,
 * so ComfyUI-format PNGs round-trip cleanly and so other tools that
 * look for `workflow` (the ecosystem default) can still read what we
 * produce. Extraction tries `nexus_workflow` first, then falls back to
 * `workflow`.
 *
 * The PNG `tEXt` chunk format (RFC: PNG specification, Section 11.3.4.3):
 *   - 4-byte big-endian length of the data field
 *   - 4-byte chunk type (`tEXt` = 0x74 0x45 0x58 0x74)
 *   - data: keyword (Latin-1, 1-79 bytes) + null byte + text (Latin-1)
 *   - 4-byte CRC of (type || data)
 *
 * This module deliberately uses no native dependencies; the CRC is a
 * lightweight implementation, the buffer arithmetic is plain Node.js.
 */

import { Buffer } from "node:buffer";

export const NEXUS_WORKFLOW_KEY = "nexus_workflow";
export const COMPAT_WORKFLOW_KEY = "workflow";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_CHUNK_TYPE = "tEXt";
const ITXT_CHUNK_TYPE = "iTXt";
const IEND_CHUNK_TYPE = "IEND";

export type DiffusionMode = "txt2img" | "img2img" | "inpaint" | "outpaint";

export interface WorkflowLoRA {
  readonly id: string;
  readonly weight: number;
}

export interface WorkflowControlNet {
  readonly modelId: string;
  readonly weight: number;
  readonly preprocessor: "pose" | "depth" | "canny" | "none";
}

export interface WorkflowMetadata {
  readonly tool: string;
  readonly version: string;
  /** v2.1.0 Phase 3 -- readers accept missing (treat as 1) and ignore unknown. */
  readonly schemaVersion?: number;
  readonly mode: DiffusionMode;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly modelId: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly cfgScale: number;
  readonly sampler: string;
  readonly seed: number;
  readonly loras?: readonly WorkflowLoRA[];
  readonly controlNet?: WorkflowControlNet;
  readonly timestamp: string;
  readonly diffusionTier?: string;
  readonly [extension: string]: unknown;
}

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(data: Buffer): number {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] ?? 0;
    const tableIndex = (crc ^ byte) & 0xff;
    const entry = table[tableIndex] ?? 0;
    crc = (entry ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(buffer: Buffer): boolean {
  if (buffer.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

function readChunks(buffer: Buffer): Chunk[] {
  if (!isPng(buffer)) {
    throw new Error("WorkflowMetadata: not a PNG buffer");
  }
  const chunks: Chunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.toString("latin1", offset, offset + 4);
    offset += 4;
    if (offset + length + 4 > buffer.length) {
      throw new Error("WorkflowMetadata: malformed PNG chunk");
    }
    const data = buffer.subarray(offset, offset + length);
    offset += length;
    // Skip CRC verification; PNG decoders typically tolerate corrupted text
    // chunks gracefully. We still advance over it.
    offset += 4;
    chunks.push({ type, data });
    if (type === IEND_CHUNK_TYPE) break;
  }
  return chunks;
}

function makeTextChunk(key: string, value: string): Buffer {
  if (!/^[\x20-\x7e]+$/.test(key)) {
    throw new Error("WorkflowMetadata: tEXt keyword must be printable ASCII");
  }
  if (key.length < 1 || key.length > 79) {
    throw new Error("WorkflowMetadata: tEXt keyword length must be 1..79 bytes");
  }
  const keyBytes = Buffer.from(key, "latin1");
  const valueBytes = Buffer.from(value, "utf8");
  const data = Buffer.concat([keyBytes, Buffer.from([0]), valueBytes]);
  const type = Buffer.from(TEXT_CHUNK_TYPE, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([length, type, data, crc]);
}

function parseTextChunk(data: Buffer): { key: string; value: string } | null {
  const nullIndex = data.indexOf(0);
  if (nullIndex < 0) return null;
  const key = data.subarray(0, nullIndex).toString("latin1");
  const value = data.subarray(nullIndex + 1).toString("utf8");
  return { key, value };
}

/**
 * PNG iTXt (uncompressed): keyword, null, compression flag 0, method 0,
 * language tag, null, translated keyword, null, UTF-8 text.
 */
function makeITxtChunk(key: string, value: string): Buffer {
  if (!/^[\x20-\x7e]+$/.test(key)) {
    throw new Error("WorkflowMetadata: iTXt keyword must be printable ASCII");
  }
  if (key.length < 1 || key.length > 79) {
    throw new Error("WorkflowMetadata: iTXt keyword length must be 1..79 bytes");
  }
  const keyBytes = Buffer.from(key, "latin1");
  const textBytes = Buffer.from(value, "utf8");
  const data = Buffer.concat([
    keyBytes,
    Buffer.from([0, 0, 0, 0, 0]),
    textBytes,
  ]);
  const type = Buffer.from(ITXT_CHUNK_TYPE, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([length, type, data, crc]);
}

function parseITxtChunk(data: Buffer): { key: string; value: string } | null {
  const keyEnd = data.indexOf(0);
  if (keyEnd < 0 || keyEnd + 5 > data.length) return null;
  const compressionFlag = data[keyEnd + 1];
  if (compressionFlag !== 0) return null;
  let offset = keyEnd + 3;
  const langEnd = data.indexOf(0, offset);
  if (langEnd < 0) return null;
  offset = langEnd + 1;
  const transEnd = data.indexOf(0, offset);
  if (transEnd < 0) return null;
  const key = data.subarray(0, keyEnd).toString("latin1");
  const value = data.subarray(transEnd + 1).toString("utf8");
  return { key, value };
}

function isWorkflowKeyword(key: string): boolean {
  return key === NEXUS_WORKFLOW_KEY || key === COMPAT_WORKFLOW_KEY;
}

/**
 * Read every tEXt chunk in a PNG and return them as a `{ keyword: value }`
 * map. Multiple chunks with the same keyword (legal per spec) collapse to
 * the last one wins, which matches how every diffusion tool we tested
 * behaves.
 */
export function readTextChunks(pngBuffer: Buffer): Record<string, string> {
  const chunks = readChunks(pngBuffer);
  const out: Record<string, string> = {};
  for (const chunk of chunks) {
    if (chunk.type === ITXT_CHUNK_TYPE) {
      const parsed = parseITxtChunk(chunk.data);
      if (parsed) out[parsed.key] = parsed.value;
      continue;
    }
    if (chunk.type !== TEXT_CHUNK_TYPE) continue;
    const parsed = parseTextChunk(chunk.data);
    if (!parsed) continue;
    out[parsed.key] = parsed.value;
  }
  return out;
}

/**
 * Embed a Nexus workflow object as `tEXt` chunks in a PNG. The buffer's
 * existing chunks are preserved, the IEND chunk is moved to the tail,
 * and new `nexus_workflow` + `workflow` (compat alias) chunks are
 * inserted just before IEND.
 *
 * Returns a fresh buffer; the input is not mutated.
 */
export function embedWorkflow(pngBuffer: Buffer, workflow: WorkflowMetadata): Buffer {
  const chunks = readChunks(pngBuffer);
  const lastChunk = chunks[chunks.length - 1];
  if (!lastChunk || lastChunk.type !== IEND_CHUNK_TYPE) {
    throw new Error("WorkflowMetadata: PNG missing IEND terminator");
  }
  const json = JSON.stringify({ ...workflow, schemaVersion: workflow.schemaVersion ?? 1 });
  const nexusText = makeTextChunk(NEXUS_WORKFLOW_KEY, json);
  const nexusItxt = makeITxtChunk(NEXUS_WORKFLOW_KEY, json);
  const compatChunk = makeTextChunk(COMPAT_WORKFLOW_KEY, json);
  // Drop any pre-existing workflow chunks so embedding is idempotent.
  const filtered = chunks.filter((chunk) => {
    if (chunk.type === ITXT_CHUNK_TYPE) {
      const parsed = parseITxtChunk(chunk.data);
      return !parsed || !isWorkflowKeyword(parsed.key);
    }
    if (chunk.type !== TEXT_CHUNK_TYPE) return true;
    const parsed = parseTextChunk(chunk.data);
    if (!parsed) return true;
    return !isWorkflowKeyword(parsed.key);
  });
  const head: Buffer[] = [PNG_SIGNATURE];
  for (const chunk of filtered) {
    if (chunk.type === IEND_CHUNK_TYPE) break;
    head.push(serializeChunk(chunk));
  }
  const iend = filtered.find((c) => c.type === IEND_CHUNK_TYPE);
  if (!iend) {
    throw new Error("WorkflowMetadata: IEND chunk missing");
  }
  return Buffer.concat([...head, nexusText, nexusItxt, compatChunk, serializeChunk(iend)]);
}

function serializeChunk(chunk: Chunk): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(chunk.data.length, 0);
  const type = Buffer.from(chunk.type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, chunk.data])), 0);
  return Buffer.concat([length, type, chunk.data, crc]);
}

function isValidWorkflow(value: unknown): value is WorkflowMetadata {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.prompt === "string" &&
    typeof v.modelId === "string" &&
    typeof v.mode === "string" &&
    ["txt2img", "img2img", "inpaint", "outpaint"].includes(v.mode as string)
  );
}

/**
 * Extract a Nexus workflow from a PNG. Tries `nexus_workflow` first, then
 * falls back to `workflow` (the ComfyUI compat alias). Returns `null` if
 * no parseable workflow is found.
 */
export function extractWorkflow(pngBuffer: Buffer): WorkflowMetadata | null {
  let chunks: Record<string, string>;
  try {
    chunks = readTextChunks(pngBuffer);
  } catch {
    return null;
  }
  for (const key of [NEXUS_WORKFLOW_KEY, COMPAT_WORKFLOW_KEY]) {
    const raw = chunks[key];
    if (typeof raw !== "string") continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isValidWorkflow(parsed)) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Helper used by tests / CLI. Builds the smallest valid PNG: a single
 * 1x1 transparent pixel. The output passes through any PNG decoder.
 */
export function createMinimalPng(): Buffer {
  // The pre-computed bytes below are a 1x1 transparent PNG produced by
  // libpng; embedding them as a constant keeps the test fixtures free of
  // external dependencies.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
}

/**
 * v2.2.5 Phase 2 -- an 8x8 PNG that passes `isUsableImageBase64` (1x1
 * catalog stubs are treated as generate failures, not pictures).
 */
export function createUsablePng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGP4z8DwHx9mGBkKAMLXf4HVAzL9AAAAAElFTkSuQmCC",
    "base64",
  );
}
