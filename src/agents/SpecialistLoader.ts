import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { getLogger } from "../utils/logger.js";
import { getSubAgentInstructions } from "./SubAgentPrompts.js";
import type { SubAgentType } from "./types.js";

export type SpecialistProvenance = "workspace" | "bundled" | "hardcoded";
export type SpecialistTier = "constrained" | "balanced" | "full";

/**
 * A loaded specialist definition. The system prompt is the body of the
 * Markdown file (frontmatter stripped); tool scope and model tier are
 * declarative metadata that callers can use to assemble the agent.
 */
export interface Specialist {
  readonly role: string;
  readonly modelTier: SpecialistTier;
  readonly toolScope: readonly string[];
  readonly systemPrompt: string;
  readonly provenance: SpecialistProvenance;
}

/** Optional event sink so callers can record provenance for tracing/metrics. */
export interface SpecialistLoadEventSink {
  emit(event: "specialist.loaded", payload: { role: string; provenance: SpecialistProvenance }): void;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const FrontmatterSchema = z.object({
  role: z.string().min(1),
  modelTier: z.enum(["constrained", "balanced", "full"]),
  toolScope: z.array(z.string().min(1)).min(0),
});

/**
 * Parse a YAML frontmatter block of the limited shape we accept for
 * specialist files. We deliberately avoid pulling in a full YAML parser to
 * keep the offline-first dependency surface minimal; the SkillLoader uses the
 * same approach. Unknown fields are ignored.
 *
 * Supported value forms:
 *   - scalar:           role: research
 *   - quoted scalar:    role: "research"
 *   - block list:       toolScope:\n  - read_file\n  - grep_codebase
 *   - inline list:      toolScope: ["read_file", "grep_codebase"]
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } | null {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) return null;
  const block = match[1] ?? "";
  const body = (match[2] ?? "").trim();

  const meta: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i += 1;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (rawValue === "") {
      const items: string[] = [];
      i += 1;
      while (i < lines.length) {
        const peek = lines[i] ?? "";
        if (/^\s*-\s+/.test(peek)) {
          items.push(peek.replace(/^\s*-\s+/, "").trim().replace(/^['"]|['"]$/g, ""));
          i += 1;
        } else if (peek.trim() === "") {
          i += 1;
        } else {
          break;
        }
      }
      meta[key] = items;
      continue;
    }

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1);
      meta[key] = inner
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter((s) => s.length > 0);
      i += 1;
      continue;
    }

    meta[key] = rawValue.replace(/^['"]|['"]$/g, "");
    i += 1;
  }

  return { meta, body };
}

function tierFromModelTier(value: unknown): SpecialistTier | null {
  if (value === "constrained" || value === "balanced" || value === "full") {
    return value;
  }
  return null;
}

const SUB_AGENT_TIER_FALLBACK: Record<SubAgentType, SpecialistTier> = {
  verification: "balanced",
  research: "balanced",
  planning: "balanced",
  // v0.7.0 Phase 7: workers run deterministic CLIs; tier is informational only.
  "audit-worker": "balanced",
  "testgaps-worker": "balanced",
  // v0.8.0 Phase 5: curator runs the CurationLoop dry-run / apply pipeline.
  "curator-worker": "balanced",
  // v0.9.0 Phase 2.5: reflect worker runs ReflectJob.dryRun directly.
  "reflect-worker": "balanced",
};

const SUB_AGENT_TOOLS_FALLBACK: Record<SubAgentType, readonly string[]> = {
  verification: ["read_file", "grep_codebase", "list_directory", "run_terminal"],
  research: ["read_file", "grep_codebase", "list_directory", "web_search", "fetch_page"],
  planning: ["read_file", "grep_codebase", "list_directory"],
  // v0.7.0 Phase 7: workers do not use the tool registry; the empty scope is
  // a marker that SubAgentManager dispatches to runWorker before building one.
  "audit-worker": [],
  "testgaps-worker": [],
  // v0.8.0 Phase 5: curator worker is deterministic; the SubAgentManager
  // dispatches to runCuratorWorker before constructing a registry.
  "curator-worker": [],
  // v0.9.0 Phase 2.5: reflect worker is deterministic.
  "reflect-worker": [],
};

/**
 * Resolve a Markdown specialist file into a fully-populated Specialist
 * record. Returns null on any parse or validation failure so the caller can
 * fall through the priority chain.
 */
function specialistFromMarkdown(
  content: string,
  provenance: SpecialistProvenance,
  sourcePath: string,
): Specialist | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    getLogger().warn(`[SpecialistLoader] ${sourcePath}: missing or malformed frontmatter`);
    return null;
  }
  const validation = FrontmatterSchema.safeParse(parsed.meta);
  if (!validation.success) {
    getLogger().warn(
      `[SpecialistLoader] ${sourcePath}: frontmatter validation failed - ${validation.error.message}`,
    );
    return null;
  }
  if (parsed.body.length === 0) {
    getLogger().warn(`[SpecialistLoader] ${sourcePath}: empty body after frontmatter`);
    return null;
  }
  return {
    role: validation.data.role,
    modelTier: validation.data.modelTier,
    toolScope: Object.freeze([...validation.data.toolScope]),
    systemPrompt: parsed.body,
    provenance,
  };
}

/**
 * Priority-chain loader for sub-agent specialist definitions.
 *
 * Resolution order:
 *   1. Workspace override at `<workspaceRoot>/.nexus/specialists/<role>.md`
 *   2. Bundled file at `<bundledDir>/<role>.md` (typically extension-install/assets/specialists)
 *   3. Hardcoded fallback derived from `SubAgentPrompts.ts`
 *
 * The hardcoded fallback ensures the runtime is robust even if the bundled
 * assets are missing (e.g. during local development before `npm run build`,
 * or when running unit tests outside the extension host).
 */
export class SpecialistLoader {
  constructor(
    private readonly _bundledDir: string,
    private readonly _workspaceRoot: string | null = null,
    private readonly _eventSink: SpecialistLoadEventSink | null = null,
  ) {}

  async load(role: SubAgentType): Promise<Specialist> {
    const fromWorkspace = this._tryWorkspaceOverride(role);
    if (fromWorkspace) {
      this._emit(role, fromWorkspace.provenance);
      return fromWorkspace;
    }

    const fromBundled = this._tryBundled(role);
    if (fromBundled) {
      this._emit(role, fromBundled.provenance);
      return fromBundled;
    }

    const fromHardcoded = this._hardcodedFallback(role);
    this._emit(role, fromHardcoded.provenance);
    return fromHardcoded;
  }

  private _tryWorkspaceOverride(role: SubAgentType): Specialist | null {
    if (this._workspaceRoot === null) return null;
    const overridePath = path.join(this._workspaceRoot, ".nexus", "specialists", `${role}.md`);
    if (!fs.existsSync(overridePath)) return null;
    let content: string;
    try {
      content = fs.readFileSync(overridePath, "utf-8");
    } catch (err) {
      getLogger().warn(
        `[SpecialistLoader] failed to read workspace override ${overridePath}; falling through`,
        err,
      );
      return null;
    }
    return specialistFromMarkdown(content, "workspace", overridePath);
  }

  private _tryBundled(role: SubAgentType): Specialist | null {
    const bundledPath = path.join(this._bundledDir, `${role}.md`);
    if (!fs.existsSync(bundledPath)) return null;
    let content: string;
    try {
      content = fs.readFileSync(bundledPath, "utf-8");
    } catch (err) {
      getLogger().warn(`[SpecialistLoader] failed to read bundled ${bundledPath}`, err);
      return null;
    }
    return specialistFromMarkdown(content, "bundled", bundledPath);
  }

  private _hardcodedFallback(role: SubAgentType): Specialist {
    return {
      role,
      modelTier: SUB_AGENT_TIER_FALLBACK[role],
      toolScope: Object.freeze([...SUB_AGENT_TOOLS_FALLBACK[role]]),
      systemPrompt: getSubAgentInstructions(role),
      provenance: "hardcoded",
    };
  }

  private _emit(role: string, provenance: SpecialistProvenance): void {
    if (!this._eventSink) return;
    try {
      this._eventSink.emit("specialist.loaded", { role, provenance });
    } catch {
      // observability must never crash the loader
    }
  }
}

export const __testing = {
  parseFrontmatter,
  tierFromModelTier,
  SUB_AGENT_TIER_FALLBACK,
  SUB_AGENT_TOOLS_FALLBACK,
};
