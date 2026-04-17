import type { Settings } from "./config.js";

export function buildUrl(s: Settings): string {
  return `http://${s.host}:${s.port}`;
}
