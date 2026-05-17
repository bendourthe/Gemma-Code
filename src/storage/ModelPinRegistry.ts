/**
 * v1.0.0 Phase 5.6 -- compat re-export. The implementation now lives at
 * `core/registry/ModelPinRegistry.ts` (closes [v0.9.0:10.N.A]). Legacy
 * VS Code-bound callers continue to import from this path; the
 * StreamingPipeline + MemoryPanelHost see no API change.
 *
 * Originally introduced as v0.8.0 Phase 6.6 (item F8). The settings-store
 * persistence backplane was added in Phase 5.6 alongside the Settings UI
 * checkbox "Keep loaded in VRAM".
 */

export {
  ModelPinRegistry,
  type ModelPinRegistryOptions,
  type ModelRecord,
  type ModelRegistrySnapshot,
  type KeepAlive,
} from "../../core/registry/ModelPinRegistry.js";
