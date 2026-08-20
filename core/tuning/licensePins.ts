/**
 * v2.1.0 Phase 5 -- pinned Unsloth Core artifacts (Apache Core + LGPL zoo).
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

export interface PinRecord {
  readonly name: string;
  readonly version?: string;
  readonly license: string;
  readonly note?: string;
  readonly pypi?: string;
}

export interface UnslothPinsFile {
  readonly verifiedOn: string;
  readonly sources: readonly string[];
  readonly provisioned: readonly PinRecord[];
  readonly excluded: readonly PinRecord[];
  readonly forbiddenArgSubstrings: readonly string[];
  readonly invocation: string;
}

function pinsPath(): string {
  const candidates = [
    typeof __dirname === "string" ? path.join(__dirname, "unsloth-pins.json") : "",
    path.resolve("core/tuning/unsloth-pins.json"),
    path.resolve(__dirname, "../../../core/tuning/unsloth-pins.json"),
  ].filter((p) => p.length > 0);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? path.resolve("core/tuning/unsloth-pins.json");
}

export function loadUnslothPins(filePath: string = pinsPath()): UnslothPinsFile {
  return JSON.parse(readFileSync(filePath, "utf8")) as UnslothPinsFile;
}

export const UNSLOTH_PINS: UnslothPinsFile = loadUnslothPins();

export function pipInstallArgs(pins: UnslothPinsFile = UNSLOTH_PINS): readonly string[] {
  return pins.provisioned.map((p) => `${p.name}==${p.version}`);
}

export function argvIncludesForbiddenExtra(
  argv: readonly string[],
  pins: UnslothPinsFile = UNSLOTH_PINS,
): boolean {
  const blob = argv.join(" ").toLowerCase();
  return pins.forbiddenArgSubstrings.some((token) => blob.includes(token.toLowerCase()));
}
