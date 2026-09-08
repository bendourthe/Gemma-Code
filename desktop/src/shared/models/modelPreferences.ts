/**
 * v2.4.8 follow-up (2026-09-07) -- the user's own model order and defaults.
 *
 * Until now a picker's order came from the catalog tier and the installer
 * snapshot, and its default from the same. Both are good starting points and
 * neither is the user's opinion. These preferences outrank both, per catalog
 * category, and are stored per install alongside the other `nexus.ui.*` keys.
 */

import type { CatalogTab } from "./catalogTabs";
import type { PreferenceStorage } from "./modelSwitchPreference";

export const DEFAULT_MODEL_PREFIX = "nexus.ui.defaultModel.";
export const MODEL_ORDER_PREFIX = "nexus.ui.modelOrder.";

export function defaultModelKey(tab: CatalogTab): string {
  return `${DEFAULT_MODEL_PREFIX}${tab}`;
}

export function modelOrderKey(tab: CatalogTab): string {
  return `${MODEL_ORDER_PREFIX}${tab}`;
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The model this category should select, or null when the user has no pick. */
export function readDefaultModel(
  tab: CatalogTab,
  storage: PreferenceStorage | null = browserStorage(),
): string | null {
  try {
    const value = storage?.getItem(defaultModelKey(tab));
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeDefaultModel(
  tab: CatalogTab,
  modelId: string | null,
  storage: PreferenceStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(defaultModelKey(tab), modelId ?? "");
  } catch {
    // A preference that cannot be stored still applies to this session.
  }
}

/** The user's order for this category; ids no longer installed are harmless. */
export function readModelOrder(
  tab: CatalogTab,
  storage: PreferenceStorage | null = browserStorage(),
): readonly string[] {
  try {
    const raw = storage?.getItem(modelOrderKey(tab));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeModelOrder(
  tab: CatalogTab,
  ids: readonly string[],
  storage: PreferenceStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(modelOrderKey(tab), JSON.stringify([...ids]));
  } catch {
    // Same as above: the order still applies to this session.
  }
}

/** Move one id one place up or down; returns a new array. */
export function reorder(
  ids: readonly string[],
  id: string,
  direction: "up" | "down",
): string[] {
  const next = [...ids];
  const from = next.indexOf(id);
  if (from < 0) return next;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= next.length) return next;
  const moved = next[from];
  const displaced = next[to];
  if (moved === undefined || displaced === undefined) return next;
  next[to] = moved;
  next[from] = displaced;
  return next;
}
