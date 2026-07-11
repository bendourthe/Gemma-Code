#!/usr/bin/env node
/**
 * v1.10.0 Phase 8 (T048) -- docs-layout consistency gate.
 *
 * The docs tree was canonicalized to the version-first scheme in v1.10.0:
 *   active:  docs/v<MAJOR>/v<MAJOR>.<MINOR>/...
 *   archive: docs/archive/v<MAJOR>/v<MAJOR>.<MINOR>/...
 * dropping the legacy `docs/versions/` and `docs/archive/versions/` wrappers.
 *
 * This gate fails if either retired wrapper directory reappears on disk, so the
 * canonical layout cannot silently regress. It checks the on-disk structure
 * (the real invariant, "no docs/versions/** paths remain"), not file contents:
 * historical prose and frozen archived docs legitimately still mention the old
 * scheme by name, and link rot predating this refactor is out of scope.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RETIRED = ["docs/versions", "docs/archive/versions"];
const EXPECTED = ["docs/v1", "docs/archive/v0"]; // canonical trees must be present

const problems = [];
for (const dir of RETIRED) {
  if (existsSync(dir)) problems.push(`retired layout dir still exists: ${dir}/`);
}
for (const dir of EXPECTED) {
  if (!existsSync(dir)) problems.push(`expected canonical dir missing: ${dir}/`);
}

// Also fail if any docs/v<MAJOR>/ contains a three-segment vX.Y.Z minor dir
// (the patch level should be collapsed into the vX.Y minor bucket).
for (const major of ["docs/v1"]) {
  if (!existsSync(major)) continue;
  for (const entry of readdirSync(major, { withFileTypes: true })) {
    if (entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name)) {
      problems.push(`non-canonical patch-level dir: ${join(major, entry.name)}/ (expected vX.Y)`);
    }
  }
}

if (problems.length > 0) {
  console.error("check-docs-layout: canonical docs layout violated:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nRun the docs-layout-refactor skill (/update refactor --canonicalize-layout) to migrate.');
  process.exit(1);
}
console.log("check-docs-layout: canonical layout OK (no docs/versions|docs/archive/versions wrappers)");
