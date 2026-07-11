#!/usr/bin/env node
/**
 * v1.10.0 Phase 7 (T039) -- naming gate.
 *
 * The Nexus-Hub catalog's on-disk provenance/namespace token was renamed from
 * the legacy `"devai-hub"` to `"nexus-hub"` in v1.10.0. This gate fails if the
 * load-bearing quoted enum value `"devai-hub"` reappears anywhere in source,
 * so it cannot silently creep back in.
 *
 * Scope: source trees only (not tests, not docs, not build artifacts). It
 * targets the QUOTED enum value; bare-prose mentions of the old name in
 * comments are not flagged. Two source sites are allowlisted because they must
 * name the old on-disk location:
 *   - core/skills/migrateLegacyCatalog.ts -- the one-shot cleanup of
 *     ~/.nexus/skills/devai-hub/.
 *   - bin/nexus.mjs -- the CLI `skills audit` reader still points at the old
 *     path (deferred reroute, NHC.P3.C).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["core", "modules", "src", "desktop/src", "desktop/sidecar/src", "bin"];
const EXTS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".venv"]);
const ALLOWLIST = new Set([
  "core/skills/migrateLegacyCatalog.ts",
  "bin/nexus.mjs",
]);
const NEEDLE = '"devai-hub"';

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (EXTS.has(extname(entry.name))) {
      out.push(full);
    }
  }
}

const files = [];
for (const root of ROOTS) walk(root, files);

const offenders = [];
for (const file of files) {
  const rel = file.replace(/\\/g, "/");
  if (ALLOWLIST.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  if (!text.includes(NEEDLE)) continue;
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(NEEDLE)) offenders.push(`${rel}:${i + 1}`);
  });
}

if (offenders.length > 0) {
  console.error(
    'check-no-devai-hub: the load-bearing "devai-hub" enum value was renamed to "nexus-hub" in v1.10.0; found it in:',
  );
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log("check-no-devai-hub: clean");
