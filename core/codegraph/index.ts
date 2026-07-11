/**
 * v1.2.0 Phase 3 -- public surface for `core/codegraph/`.
 *
 * Re-exports the store, scanner, MCP server, and manifest so consumers
 * (notably the Coding-pillar engine in `src/`) can import the whole
 * subsystem from one path. See `docs/v1/v1.2/plans/adoption-ecosystem-2026-05.md`
 * Phase 3 for the design context.
 */

export * from "./types.js";
export * from "./manifest.js";
export * from "./store/index.js";
export * from "./scanner/index.js";
export * from "./mcp/index.js";
