/**
 * v2.2.9 Phase 6.1 (T012) -- Nexus-Hub release-tag normalization.
 *
 * The installed catalog records its version without a leading `v` ("3.21.0",
 * from `nexus-hub-version.json` / plugin.json) while GitHub release tags carry
 * one ("v3.21.0"). Comparing those raw strings made Skills claim an update
 * from 3.21.0 to v3.21.0 (screenshot 10). Every compare and every display of a
 * Hub tag goes through this module so the two spellings are one version.
 */

/**
 * Canonical compare form: trimmed, one leading `v`/`V` stripped, lowercased.
 * Returns null for null/undefined/blank input so "unknown" never equals
 * anything (including another unknown at the call sites, which guard nulls).
 */
export function normalizeHubTag(tag: string | null | undefined): string | null {
  if (tag === null || tag === undefined) return null;
  const trimmed = tag.trim();
  if (trimmed === "") return null;
  return trimmed.replace(/^[vV]/, "").toLowerCase();
}

/** True when both tags are known and name the same version. */
export function hubTagsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeHubTag(a);
  const nb = normalizeHubTag(b);
  return na !== null && nb !== null && na === nb;
}

/**
 * Canonical display form: the version without the leading `v`, original case
 * otherwise ("v3.21.0" -> "3.21.0"). Null passes through so callers keep their
 * own "none" fallbacks.
 */
export function displayHubTag(tag: string | null | undefined): string | null {
  if (tag === null || tag === undefined) return null;
  const trimmed = tag.trim();
  if (trimmed === "") return null;
  return trimmed.replace(/^[vV]/, "");
}
