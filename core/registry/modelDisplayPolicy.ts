/** Canonical v2.4.1 model roster and display ordering shared by product surfaces. */

export interface ModelDisplayRow {
  readonly id: string;
  readonly displayName?: string;
  readonly task?: string;
  readonly source?: string;
  readonly tags?: readonly string[];
  readonly type?: string;
  readonly installed?: boolean;
  readonly releaseDate?: string;
}

export type ModelDisplayTier = "required" | "recommended" | "compatible";

export function isUserSelectableCatalogRow(row: ModelDisplayRow): boolean {
  return typeof row.task === "string" && row.task.trim().length > 0 && row.source !== "external";
}

export function modelDisplayTier(row: ModelDisplayRow): ModelDisplayTier {
  const tags = row.tags ?? [];
  if (tags.includes("required") || row.task === "embed" || row.type === "embed") {
    return "required";
  }
  return tags.includes("recommended") ? "recommended" : "compatible";
}

function tierRank(row: ModelDisplayRow): number {
  const tier = modelDisplayTier(row);
  return tier === "required" ? 0 : tier === "recommended" ? 1 : 2;
}

function releaseOrdinal(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : 0;
}

function folded(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replaceAll("ß", "ss")
    .replaceAll("ς", "σ");
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareModelDisplayRows(a: ModelDisplayRow, b: ModelDisplayRow): number {
  const tier = tierRank(a) - tierRank(b);
  if (tier !== 0) return tier;
  const release = releaseOrdinal(b.releaseDate) - releaseOrdinal(a.releaseDate);
  if (release !== 0) return release;
  const name = compareText(folded(a.displayName || a.id), folded(b.displayName || b.id));
  if (name !== 0) return name;
  return compareText(folded(a.id), folded(b.id));
}

export function canonicalModelDisplayOrder<T extends ModelDisplayRow>(rows: readonly T[]): T[] {
  return rows.filter(isUserSelectableCatalogRow).sort(compareModelDisplayRows);
}

export function installedOutsideCatalog<T extends ModelDisplayRow>(rows: readonly T[]): T[] {
  return rows
    .filter(
      (row) =>
        row.source === "external" ||
        (row.source === "registry" && row.installed === true && !row.task && row.type !== "vae" && row.type !== "controlnet"),
    )
    .sort((a, b) => compareText(folded(a.displayName || a.id), folded(b.displayName || b.id)));
}
