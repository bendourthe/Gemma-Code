import { DEFAULT_SETTINGS, type Settings } from "./config.js";

export function mergeRetries(s: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...s };
}
