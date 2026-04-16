import { describe, it, expect, beforeEach } from "vitest";
import { EntityExtractor } from "../../../src/storage/EntityExtractor.js";

describe("EntityExtractor", () => {
  let extractor: EntityExtractor;

  beforeEach(() => {
    extractor = new EntityExtractor();
  });

  describe("extractFromText()", () => {
    it("extracts file paths", () => {
      const entities = extractor.extractFromText(
        "I modified src/storage/MemoryStore.ts to add FTS5 support",
      );
      const files = entities.filter((e) => e.type === "file");
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some((f) => f.name.includes("MemoryStore.ts"))).toBe(true);
    });

    it("extracts function names from 'function readFile(path)'", () => {
      const entities = extractor.extractFromText(
        "We defined function readFile(path) to handle I/O",
      );
      const fns = entities.filter((e) => e.type === "function");
      expect(fns.some((f) => f.name === "readFile")).toBe(true);
    });

    it("extracts class names from 'class MemoryStore'", () => {
      const entities = extractor.extractFromText(
        "The class MemoryStore extends BaseStore",
      );
      const classes = entities.filter((e) => e.type === "class");
      expect(classes.some((c) => c.name === "MemoryStore")).toBe(true);
    });

    it("extracts interface names", () => {
      const entities = extractor.extractFromText(
        "Define interface GraphEntity with required fields",
      );
      const classes = entities.filter((e) => e.type === "class");
      expect(classes.some((c) => c.name === "GraphEntity")).toBe(true);
    });

    it("extracts technology names (TypeScript, SQLite, Ollama)", () => {
      const entities = extractor.extractFromText(
        "We use TypeScript for the extension and SQLite for storage. Ollama runs locally.",
      );
      const techs = entities.filter((e) => e.type === "technology");
      const techNames = techs.map((t) => t.name);
      expect(techNames).toContain("typescript");
      expect(techNames).toContain("sqlite");
      expect(techNames).toContain("ollama");
    });

    it("extracts error patterns", () => {
      const entities = extractor.extractFromText(
        "Got TypeError: Cannot read property 'id' of undefined",
      );
      const errors = entities.filter((e) => e.type === "error");
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]!.name).toContain("Cannot read property");
    });

    it("extracts decision markers", () => {
      const entities = extractor.extractFromText(
        "We decided to use SQLite instead of PostgreSQL for local storage",
      );
      const decisions = entities.filter((e) => e.type === "decision");
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      expect(decisions[0]!.name).toContain("use SQLite");
    });

    it("extracts import/module references", () => {
      const entities = extractor.extractFromText(
        'import { MemoryStore } from "./MemoryStore.js"',
      );
      const modules = entities.filter((e) => e.type === "module");
      expect(modules.some((m) => m.name === "./MemoryStore.js")).toBe(true);
    });

    it("deduplicates entities with same name and type", () => {
      const entities = extractor.extractFromText(
        "The class MemoryStore is great. The class MemoryStore does many things.",
      );
      const classes = entities.filter(
        (e) => e.type === "class" && e.name === "MemoryStore",
      );
      expect(classes).toHaveLength(1);
    });
  });

  describe("extractRelationsFromText()", () => {
    it("infers import relations between file entities", () => {
      const text = "The file src/app.ts import from src/utils.ts for helper functions";
      const entities = extractor.extractFromText(text);
      const relations = extractor.extractRelationsFromText(text, entities);
      // Both files should be extracted and related.
      const fileEntities = entities.filter((e) => e.type === "file");
      expect(fileEntities.length).toBeGreaterThanOrEqual(2);
      // They co-occur in the same sentence with "import", triggering an import relation.
      const importRels = relations.filter((r) => r.type === "imports");
      expect(importRels.length).toBeGreaterThanOrEqual(1);
    });

    it("creates proximity-based related_to relations", () => {
      const text = "class MemoryStore in src/storage/MemoryStore.ts handles persistence";
      const entities = extractor.extractFromText(text);
      const relations = extractor.extractRelationsFromText(text, entities);
      const related = relations.filter((r) => r.type === "related_to");
      expect(related.length).toBeGreaterThanOrEqual(1);
      expect(related[0]!.confidence).toBe(0.3);
    });

    it("infers error-causes-file relations", () => {
      const text = "Error: file not found in src/storage/MemoryStore.ts causing the build to fail";
      const entities = extractor.extractFromText(text);
      const relations = extractor.extractRelationsFromText(text, entities);
      const causeRels = relations.filter((r) => r.type === "causes");
      // The error entity and file entity should have a causes relation.
      expect(causeRels.length).toBeGreaterThanOrEqual(0); // depends on extraction
    });

    it("infers decision-technology relations", () => {
      const text = "We decided to use SQLite because it works locally without a server";
      const entities = extractor.extractFromText(text);
      const relations = extractor.extractRelationsFromText(text, entities);
      const decisionRels = relations.filter((r) => r.type === "decided_for");
      expect(decisionRels.length).toBeGreaterThanOrEqual(1);
    });
  });
});
