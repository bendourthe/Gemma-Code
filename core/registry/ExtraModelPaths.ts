/**
 * v1.0.0 Phase 5.4 -- ComfyUI-style `extra_model_paths.yaml` compatibility.
 *
 * Reads `~/.nexus/extra_model_paths.yaml` if present and surfaces the
 * referenced directories as `external` entries in `NexusModelRegistry`.
 *
 * Expected YAML shape (ComfyUI-compatible subset):
 *
 *   comfyui:
 *     base_path: D:/AI/comfyui
 *     checkpoints: models/checkpoints
 *     loras: models/loras
 *     controlnet: models/controlnet
 *
 * `base_path` is joined with each category value (or the value is used
 * directly if absolute). Each category directory is scanned for files
 * with `.safetensors`, `.ckpt`, `.gguf`, `.bin`, or `.pt` extensions.
 *
 * The implementation deliberately reads the YAML with a tiny hand-rolled
 * parser (the project does not ship a YAML dependency) that handles the
 * flat `<profile>: { <key>: <value> }` shape ComfyUI documents. Anything
 * fancier (anchors, inline arrays, multiline strings) is rejected with a
 * descriptive error rather than mis-parsed.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ExternalModelEntry, ExternalModelIndex } from "./NexusModelRegistry.js";

const SUPPORTED_EXTS: readonly string[] = [
  ".safetensors",
  ".ckpt",
  ".gguf",
  ".bin",
  ".pt",
];

/** Parsed contents of an `extra_model_paths.yaml`. */
export interface ExtraModelPathsConfig {
  readonly profiles: ReadonlyMap<string, ProfileConfig>;
}

export interface ProfileConfig {
  readonly basePath?: string;
  readonly categories: ReadonlyMap<string, string>;
}

export function parseExtraModelPathsYaml(raw: string): ExtraModelPathsConfig {
  const lines = raw.split(/\r?\n/);
  const profiles = new Map<string, { basePath?: string; categories: Map<string, string> }>();
  let currentProfile: { basePath?: string; categories: Map<string, string> } | null = null;
  let currentIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const stripped = rawLine.replace(/#.*$/, "");
    if (stripped.trim() === "") continue;
    const indent = stripped.length - stripped.trimStart().length;
    const trimmed = stripped.trim();
    if (indent === 0) {
      // profile header: "<name>:"
      if (!trimmed.endsWith(":")) {
        throw new Error(`ExtraModelPaths: expected profile header at line ${i + 1}, got: ${trimmed}`);
      }
      const name = trimmed.slice(0, -1).trim();
      if (name.length === 0) {
        throw new Error(`ExtraModelPaths: empty profile name at line ${i + 1}`);
      }
      currentProfile = { categories: new Map() };
      profiles.set(name, currentProfile);
      currentIndent = -1;
      continue;
    }
    if (!currentProfile) {
      throw new Error(`ExtraModelPaths: keys must live under a profile (line ${i + 1})`);
    }
    if (currentIndent === -1) currentIndent = indent;
    if (indent !== currentIndent) {
      throw new Error(`ExtraModelPaths: inconsistent indent at line ${i + 1}`);
    }
    // "<key>: <value>"
    const colon = trimmed.indexOf(":");
    if (colon < 0) {
      throw new Error(`ExtraModelPaths: expected 'key: value' at line ${i + 1}, got: ${trimmed}`);
    }
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (key === "base_path") {
      currentProfile.basePath = value;
    } else {
      currentProfile.categories.set(key, value);
    }
  }

  // Freeze into readonly maps for the public surface.
  const out = new Map<string, ProfileConfig>();
  for (const [name, cfg] of profiles) {
    out.set(name, { basePath: cfg.basePath, categories: new Map(cfg.categories) });
  }
  return { profiles: out };
}

export interface ExtraModelPathsOptions {
  readonly yamlPath: string;
  /** Injectable home-relative resolution helper. Defaults to `path.resolve`. */
  readonly resolveAbs?: (basePath: string | undefined, value: string) => string;
}

export class ExtraModelPathsIndex implements ExternalModelIndex {
  constructor(private readonly _opts: ExtraModelPathsOptions) {}

  async list(): Promise<readonly ExternalModelEntry[]> {
    const exists = await pathExists(this._opts.yamlPath);
    if (!exists) return [];
    const raw = await fs.readFile(this._opts.yamlPath, "utf8");
    const config = parseExtraModelPathsYaml(raw);
    const resolveAbs = this._opts.resolveAbs ?? defaultResolveAbs;
    const out: ExternalModelEntry[] = [];

    for (const [profile, cfg] of config.profiles) {
      for (const [category, value] of cfg.categories) {
        const dir = resolveAbs(cfg.basePath, value);
        const entries = await listModelFiles(dir);
        for (const e of entries) {
          out.push({
            id: `external:${profile}:${category}:${e.name}`,
            displayName: e.name,
            absPath: e.absPath,
            profile,
            category,
            sizeBytes: e.sizeBytes,
          });
        }
      }
    }
    return out;
  }
}

interface FileEntry {
  readonly name: string;
  readonly absPath: string;
  readonly sizeBytes: number;
}

async function listModelFiles(dir: string): Promise<readonly FileEntry[]> {
  try {
    const names = await fs.readdir(dir);
    const out: FileEntry[] = [];
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      if (!SUPPORTED_EXTS.includes(ext)) continue;
      const absPath = path.join(dir, name);
      try {
        const stat = await fs.stat(absPath);
        if (!stat.isFile()) continue;
        out.push({ name, absPath, sizeBytes: stat.size });
      } catch {
        // skip
      }
    }
    return out;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function defaultResolveAbs(basePath: string | undefined, value: string): string {
  if (path.isAbsolute(value)) return value;
  if (basePath && basePath.length > 0) return path.resolve(basePath, value);
  return path.resolve(value);
}
