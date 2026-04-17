import type { Settings } from "./config.js";

export function describe(s: Settings): string {
  return `${s.host}:${s.port}`;
}
