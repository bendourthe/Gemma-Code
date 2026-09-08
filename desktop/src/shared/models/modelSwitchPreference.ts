/**
 * v2.4.8 follow-up (2026-09-07) -- "Do not show again" for the switch dialog.
 *
 * The dialog is the only thing standing between a click and a stopped job, so
 * it asks by default. A user who switches models constantly can turn it off
 * from the dialog itself and turn it back on in Settings > Preferences.
 * Stored per install in localStorage, like the other renderer-side UI
 * preferences (`nexus.ui.*`).
 */

export const ASK_BEFORE_MODEL_SWITCH_KEY = "nexus.ui.askBeforeModelSwitch";

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private mode / blocked storage: fall back to the safe default.
    return null;
  }
}

/** True unless the user has explicitly turned the dialog off. */
export function askBeforeModelSwitch(
  storage: PreferenceStorage | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(ASK_BEFORE_MODEL_SWITCH_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setAskBeforeModelSwitch(
  value: boolean,
  storage: PreferenceStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(ASK_BEFORE_MODEL_SWITCH_KEY, value ? "true" : "false");
  } catch {
    // A preference that cannot be stored still applies to this session.
  }
}
