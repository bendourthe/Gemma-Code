/**
 * v1.18.0 Phase 3 (LG-A3) -- MoE resident-vs-active footprint helpers.
 *
 * Dense catalog entries omit `activeParams` / `totalParams`. When those fields
 * are present, compute-tier reasoning prefers active parameters and residency
 * / VRAM estimates prefer total parameters (never the active count, which
 * would under-count the resident footprint).
 *
 * Boundary: pure; core/** (no modules/**).
 */

export interface MoeFootprintEntry {
  readonly vramGb?: number;
  readonly vramGB?: number;
  readonly activeParams?: number;
  readonly totalParams?: number;
}

/**
 * Conservative VRAM GB for scheduler / panel co-residency. Prefers an explicit
 * `vramGb` / `vramGB`. When only MoE params are known, estimates from
 * `totalParams` (billions) and NEVER from `activeParams`.
 */
export function conservativeResidentVramGb(entry: MoeFootprintEntry): number | undefined {
  const vram = entry.vramGb ?? entry.vramGB;
  if (typeof vram === "number" && Number.isFinite(vram) && vram > 0) {
    return vram;
  }
  if (typeof entry.totalParams === "number" && Number.isFinite(entry.totalParams) && entry.totalParams > 0) {
    // Conservative GGUF-ish: ~0.6 GB per billion total parameters. Active
    // params are ignored so a large-MoE resident set is never under-counted.
    return Math.max(1, entry.totalParams * 0.6);
  }
  return undefined;
}

/** True when the entry declares a MoE resident footprint larger than active compute. */
export function isMoeResident(entry: MoeFootprintEntry): boolean {
  if (typeof entry.totalParams !== "number" || !Number.isFinite(entry.totalParams)) {
    return false;
  }
  const active =
    typeof entry.activeParams === "number" && Number.isFinite(entry.activeParams)
      ? entry.activeParams
      : 0;
  return entry.totalParams > active;
}
