#!/usr/bin/env node
/**
 * v1.1.0 Phase 1 sub-task 1.3 -- inject `deprecationMessage` into every legacy
 * `gemma-code.*` entry in `package.json` `contributes.configuration.properties`.
 *
 * Source of truth: `SETTINGS_KEY_MAP` in `modules/coding/config/settingsKeyMap.ts` -- the
 * map of `nexus.*` (new) -> `gemma-code.*` (legacy) keys. For every entry in
 * the map that has a corresponding `gemma-code.*` property defined in
 * `package.json`, set:
 *
 *   "deprecationMessage": "Use `${newKey}` instead. Will be removed in v1.2.0."
 *
 * Idempotent: re-runs overwrite the deprecation message with the same value
 * (good for keeping the message uniform across map edits).
 *
 * Run via:
 *   node scripts/dev/inject-deprecation-messages.mjs
 *
 * Then commit the resulting `package.json` diff.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

const DEPRECATION_TEMPLATE = "Use `%NEW%` instead. Will be removed in v1.2.0.";
const REMOVAL_VERSION = "v1.2.0";

function loadSettingsKeyMap() {
  // The map lives in TypeScript and uses `Object.freeze(...)`; parse it as a
  // simple regex-based extraction so this script stays zero-dependency and
  // does not require ts-node / tsx.
  const src = readFileSync(
    join(REPO_ROOT, "modules", "coding", "config", "settingsKeyMap.ts"),
    "utf-8",
  );
  // Find each "<new>": "<legacy>" pair. Allow both quote styles and ignore
  // comments / blank lines.
  const map = new Map();
  const pairRe = /"(nexus\.[a-zA-Z0-9_.-]+)"\s*:\s*"(gemma-code\.[a-zA-Z0-9_.-]+)"/g;
  let m;
  while ((m = pairRe.exec(src)) !== null) {
    const [, newKey, legacyKey] = m;
    map.set(legacyKey, newKey);
  }
  if (map.size === 0) {
    throw new Error(
      "Could not parse any entries from modules/coding/config/settingsKeyMap.ts; aborting.",
    );
  }
  return map;
}

function main() {
  const pkgPath = join(REPO_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const props = pkg.contributes?.configuration?.properties;
  if (!props || typeof props !== "object") {
    throw new Error(
      `package.json has no contributes.configuration.properties; nothing to do.`,
    );
  }

  const legacyToNew = loadSettingsKeyMap();
  let injected = 0;
  let skipped = 0;
  let alreadyCurrent = 0;

  for (const [legacyKey, newKey] of legacyToNew) {
    const entry = props[legacyKey];
    if (!entry || typeof entry !== "object") {
      skipped++;
      continue;
    }
    const message = DEPRECATION_TEMPLATE.replace("%NEW%", newKey);
    if (entry.deprecationMessage === message) {
      alreadyCurrent++;
      continue;
    }
    entry.deprecationMessage = message;
    injected++;
  }

  // Also walk every remaining `gemma-code.*` property that is NOT in the map
  // (e.g. one-off cross-cutting keys) and inject a generic deprecation message
  // pointing at the same `nexus.*` namespace by string substitution. The map
  // covers the renamed keys; this catch-all covers entries that should also be
  // marked as deprecated even when no explicit mapping was recorded.
  for (const key of Object.keys(props)) {
    if (!key.startsWith("gemma-code.")) continue;
    if (legacyToNew.has(key)) continue;
    const entry = props[key];
    if (!entry || typeof entry !== "object") continue;
    // Derive a plausible nexus.* counterpart for the message body.
    const candidate = key.replace(/^gemma-code\./, "nexus.");
    const message =
      `This setting is scheduled for removal in ${REMOVAL_VERSION}. ` +
      `If you rely on it, file an issue referencing \`${candidate}\` so a ` +
      `canonical replacement key is added before removal.`;
    if (entry.deprecationMessage === message) {
      alreadyCurrent++;
      continue;
    }
    entry.deprecationMessage = message;
    injected++;
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

  console.log(
    `[inject-deprecation-messages] injected=${injected} already-current=${alreadyCurrent} skipped=${skipped}`,
  );
}

main();
