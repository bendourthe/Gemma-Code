/**
 * v1.2.0 Phase 3 -- store re-exports.
 *
 * The concrete persistence is `SqliteGraphStore`; we expose it via the
 * subpackage barrel so `core/codegraph/index.ts` can re-export the public
 * surface without leaking the file layout to consumers.
 */

export {
  SqliteGraphStore,
  resolveCodegraphDbPath,
  type SqliteGraphStoreOptions,
} from "./SqliteGraphStore.js";
