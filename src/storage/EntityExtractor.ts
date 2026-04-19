import type { EntityType, RelationType } from "./MemoryLayers.types.js";

export interface ExtractedEntity {
  readonly name: string;
  readonly type: EntityType;
  /** Position of the first occurrence. Preserved for backward compatibility. */
  readonly startIndex: number;
  /** End position of the first occurrence. Preserved for backward compatibility. */
  readonly endIndex: number;
  /**
   * All `{start, end}` positions where this entity appears in the source text.
   * In-memory only; the persisted graph schema records `(name, type)` once.
   */
  readonly occurrences: ReadonlyArray<{ start: number; end: number }>;
}

export interface ExtractedRelation {
  readonly source: ExtractedEntity;
  readonly target: ExtractedEntity;
  readonly type: RelationType;
  readonly confidence: number;
}

/** Curated list of common technologies for name matching. */
const TECHNOLOGY_NAMES = new Set([
  "react", "typescript", "javascript", "python", "rust", "go", "java", "c++",
  "node", "nodejs", "express", "fastapi", "django", "flask", "spring",
  "sqlite", "postgres", "postgresql", "mysql", "mongodb", "redis",
  "docker", "kubernetes", "aws", "azure", "gcp", "terraform",
  "git", "github", "gitlab", "ollama", "vscode", "vitest", "jest",
  "webpack", "vite", "rollup", "esbuild", "babel", "eslint", "prettier",
  "ruff", "cargo", "npm", "pnpm", "yarn", "pip", "uv",
  "graphql", "rest", "grpc", "websocket", "http", "https",
  "linux", "macos", "windows", "wasm", "webassembly",
  "openai", "anthropic", "gemma", "llama", "mistral",
  "tailwind", "css", "html", "svelte", "vue", "angular", "nextjs",
]);

/**
 * Split text into sentence spans with character positions in the original text.
 * Sentences end at `.` `!` `?` followed by whitespace OR at one-or-more newlines.
 * Periods inside file-extension-like patterns (`.ts`, `.json`) do not split.
 */
function splitIntoSentenceSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re = /(?<!\.\w{1,5})[.!?]\s+|\n+/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index >= lastEnd) {
      spans.push({ start: lastEnd, end: match.index });
    }
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < text.length) {
    spans.push({ start: lastEnd, end: text.length });
  }
  return spans;
}

/**
 * Regex-based entity extraction from text. Designed to be fast (no LLM calls)
 * since it runs on every compaction cycle.
 */
export class EntityExtractor {
  /**
   * Extract entities from free-form text using regex patterns.
   */
  extractFromText(text: string): ExtractedEntity[] {
    // Mutable working storage so we can accumulate occurrences across passes.
    const byKey = new Map<string, {
      name: string;
      type: EntityType;
      startIndex: number;
      endIndex: number;
      occurrences: Array<{ start: number; end: number }>;
    }>();

    const addEntity = (
      name: string,
      type: EntityType,
      startIndex: number,
      endIndex: number,
    ): void => {
      const key = `${name}:${type}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.occurrences.push({ start: startIndex, end: endIndex });
        return;
      }
      byKey.set(key, {
        name,
        type,
        startIndex,
        endIndex,
        occurrences: [{ start: startIndex, end: endIndex }],
      });
    };

    // File paths: word/word.ext or word\word.ext
    for (const match of text.matchAll(
      /[a-zA-Z0-9_\-./\\]+\/[a-zA-Z0-9_.\-]+\.[a-zA-Z]{1,10}/g,
    )) {
      if (match.index !== undefined) {
        addEntity(match[0], "file", match.index, match.index + match[0].length);
      }
    }

    // Bare filenames with recognized code extensions (no slash). Prevents
    // over-matching generic identifier.method patterns while still catching
    // references like "MemoryStore.ts" in prose.
    for (const match of text.matchAll(
      /\b([A-Za-z_][A-Za-z0-9_.-]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cpp|cc|c|h|hpp|md|json|yaml|yml|toml|sh|ps1))\b/g,
    )) {
      if (match[1] && match.index !== undefined) {
        addEntity(match[1], "file", match.index, match.index + match[1].length);
      }
    }

    // Function/method names
    for (const match of text.matchAll(
      /(?:function|def|fn|func|method|async\s+function)\s+([a-zA-Z_]\w*)/g,
    )) {
      if (match[1] && match.index !== undefined) {
        const start = match.index + match[0].indexOf(match[1]);
        addEntity(match[1], "function", start, start + match[1].length);
      }
    }

    // Class/interface/struct/enum/type names
    for (const match of text.matchAll(
      /(?:class|interface|struct|enum|type)\s+([A-Z][a-zA-Z0-9_]*)/g,
    )) {
      if (match[1] && match.index !== undefined) {
        const start = match.index + match[0].indexOf(match[1]);
        addEntity(match[1], "class", start, start + match[1].length);
      }
    }

    // Import/module references
    for (const match of text.matchAll(
      /(?:import|require|from)\s+['"]([^'"]+)['"]/g,
    )) {
      if (match[1] && match.index !== undefined) {
        const start = match.index + match[0].indexOf(match[1]);
        addEntity(match[1], "module", start, start + match[1].length);
      }
    }

    // Technology names (word-boundary match against curated list)
    const words = text.split(/[\s,;:()[\]{}<>'"]+/);
    let searchIndex = 0;
    for (const word of words) {
      const lower = word.toLowerCase().replace(/[^a-z0-9+#]/g, "");
      if (lower && TECHNOLOGY_NAMES.has(lower)) {
        const idx = text.indexOf(word, searchIndex);
        if (idx !== -1) {
          addEntity(lower, "technology", idx, idx + word.length);
          searchIndex = idx + word.length;
        }
      }
    }

    // Error patterns
    for (const match of text.matchAll(
      /(?:Error|Exception|FAIL|FAILED|TypeError|ReferenceError|SyntaxError):\s*(.{3,80})/g,
    )) {
      if (match[1] && match.index !== undefined) {
        const errorText = match[1].replace(/[\n\r]+.*/, "").trim();
        if (errorText) {
          addEntity(errorText, "error", match.index, match.index + match[0].length);
        }
      }
    }

    // Decision markers
    for (const match of text.matchAll(
      /(?:decided to|going with|chose|choosing|opting for)\s+(.{3,80})/gi,
    )) {
      if (match[1] && match.index !== undefined) {
        const decisionText = match[1].replace(/[.!?\n].*/, "").trim();
        if (decisionText) {
          addEntity(decisionText, "decision", match.index, match.index + match[0].length);
        }
      }
    }

    // Materialize the working storage into immutable ExtractedEntity records.
    return Array.from(byKey.values()).map((e) => ({
      name: e.name,
      type: e.type,
      startIndex: e.startIndex,
      endIndex: e.endIndex,
      occurrences: e.occurrences,
    }));
  }

  /**
   * Infer relationships between extracted entities based on co-occurrence
   * and syntactic patterns.
   */
  extractRelationsFromText(
    text: string,
    entities: ExtractedEntity[],
  ): ExtractedRelation[] {
    const relations: ExtractedRelation[] = [];
    const seen = new Set<string>();

    const addRelation = (
      source: ExtractedEntity,
      target: ExtractedEntity,
      type: RelationType,
      confidence: number,
    ): void => {
      const key = `${source.name}:${source.type}->${target.name}:${target.type}:${type}`;
      if (seen.has(key)) return;
      seen.add(key);
      relations.push({ source, target, type, confidence });
    };

    // Split text into sentence spans (with character positions). Avoid splitting
    // on periods inside file extensions (e.g. ".ts", ".js").
    const sentenceSpans = splitIntoSentenceSpans(text);

    for (const span of sentenceSpans) {
      const sentence = text.slice(span.start, span.end);
      const lower = sentence.toLowerCase();

      // Find entities that have at least one occurrence inside this sentence's
      // character range. This avoids spurious matches from `.includes(name)`
      // when the same name appears in unrelated text.
      const inSentence = entities.filter((e) =>
        e.occurrences.some((o) => o.start >= span.start && o.end <= span.end),
      );

      for (let i = 0; i < inSentence.length; i++) {
        for (let j = i + 1; j < inSentence.length; j++) {
          const a = inSentence[i]!;
          const b = inSentence[j]!;

          // Import relations
          if (
            (lower.includes("import") || lower.includes("require")) &&
            a.type === "file" && b.type === "file"
          ) {
            addRelation(a, b, "imports", 0.8);
            continue;
          }

          // Function modifies file
          if (a.type === "function" && b.type === "file") {
            addRelation(a, b, "modifies", 0.6);
            continue;
          }
          if (b.type === "function" && a.type === "file") {
            addRelation(b, a, "modifies", 0.6);
            continue;
          }

          // Error causes relation
          if (a.type === "error" && b.type === "file") {
            addRelation(b, a, "causes", 0.7);
            continue;
          }
          if (b.type === "error" && a.type === "file") {
            addRelation(a, b, "causes", 0.7);
            continue;
          }

          // Decision + technology
          if (a.type === "decision" && b.type === "technology") {
            addRelation(a, b, "decided_for", 0.7);
            continue;
          }
          if (b.type === "decision" && a.type === "technology") {
            addRelation(b, a, "decided_for", 0.7);
            continue;
          }
        }
      }
    }

    // Proximity-based related_to for entities within 100 characters.
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i]!;
        const b = entities[j]!;
        const distance = Math.abs(a.startIndex - b.startIndex);
        if (distance <= 100) {
          addRelation(a, b, "related_to", 0.3);
        }
      }
    }

    return relations;
  }
}
