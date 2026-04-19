/**
 * Shared numeric constants used across the storage and graph-memory layer.
 * Centralized so the values are documented in one place rather than scattered
 * as magic numbers (review finding #102).
 */

/** Heuristic English chars-per-token ratio used by token estimators. */
export const CHARS_PER_TOKEN = 4;

/** Maximum number of graph nodes a single traversal will visit. */
export const MAX_NODES_VISITED = 100;

/** Maximum nodes returned from a graph BFS expansion to bound result size. */
export const GRAPH_MAX_TRAVERSAL_RESULTS = 50;

/** One day in milliseconds. Used by graph recency weighting. */
export const ONE_DAY_MS = 86_400_000;

/** One week in milliseconds. Used by graph recency weighting. */
export const ONE_WEEK_MS = 604_800_000;
