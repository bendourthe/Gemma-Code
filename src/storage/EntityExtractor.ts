import type { EntityType, RelationType } from "./MemoryLayers.types.js";

export interface ExtractedEntity {
  readonly name: string;
  readonly type: EntityType;
  readonly startIndex: number;
  readonly endIndex: number;
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
 * Regex-based entity extraction from text. Designed to be fast (no LLM calls)
 * since it runs on every compaction cycle.
 */
export class EntityExtractor {
  /**
   * Extract entities from free-form text using regex patterns.
   */
  extractFromText(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    const addEntity = (
      name: string,
      type: EntityType,
      startIndex: number,
      endIndex: number,
    ): void => {
      const key = `${name}:${type}`;
      if (seen.has(key)) return;
      seen.add(key);
      entities.push({ name, type, startIndex, endIndex });
    };

    // File paths: word/word.ext or word\word.ext
    for (const match of text.matchAll(
      /[a-zA-Z0-9_\-./\\]+\/[a-zA-Z0-9_.\-]+\.[a-zA-Z]{1,10}/g,
    )) {
      if (match.index !== undefined) {
        addEntity(match[0], "file", match.index, match.index + match[0].length);
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

    return entities;
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

    // Split text into sentences. Use newlines and sentence-ending punctuation
    // but avoid splitting on periods inside file extensions (e.g. ".ts", ".js").
    const sentences = text.split(/(?<!\.\w{1,5})[.!?]\s+|\n+/);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();

      // Find entities that appear in this sentence.
      const inSentence = entities.filter((e) =>
        sentence.includes(e.name) ||
        lower.includes(e.name.toLowerCase()),
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
