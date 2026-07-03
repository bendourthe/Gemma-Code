/**
 * sync-tauri-version.mjs -- v1.8.0 Phase 1 (T101).
 *
 * Syncs the desktop shell's Tauri config version from the root package.json,
 * the single semantic-release-owned version source. `tauri build` stamps
 * `bundle.version` (and therefore every bundle filename, e.g.
 * `Nexus_<version>_x64-setup.exe`) from `desktop/src-tauri/tauri.conf.json`,
 * which otherwise goes stale between releases (it sat at 1.5.0 while the
 * repo shipped 2.1.0).
 *
 * The release pipeline's `desktop-bundle` jobs run this immediately before
 * `tauri build`, so the committed value never has to be current -- the sync
 * happens at build time, per the v1.8.0 plan.
 *
 * Usage:
 *   node scripts/sync-tauri-version.mjs           # apply (rewrites tauri.conf.json)
 *   node scripts/sync-tauri-version.mjs --check   # exit 1 if out of sync, write nothing
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const pkgPath = path.join(repoRoot, "package.json");
const tauriConfPath = path.join(repoRoot, "desktop", "src-tauri", "tauri.conf.json");

/** Extract the version field from a package.json text. Throws on absence. */
export function readRootVersion(pkgText) {
  const version = JSON.parse(pkgText).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json has no version field");
  }
  return version;
}

/**
 * Return the tauri.conf.json text with its top-level `version` set to
 * `version`, preserving the file's 2-space indentation and trailing newline.
 * Pure: no I/O. Returns `{ text, changed, previous }`.
 */
export function syncedTauriConf(confText, version) {
  const conf = JSON.parse(confText);
  const previous = conf.version;
  if (previous === version) {
    return { text: confText, changed: false, previous };
  }
  conf.version = version;
  return { text: `${JSON.stringify(conf, null, 2)}\n`, changed: true, previous };
}

function run(checkOnly) {
  const version = readRootVersion(fs.readFileSync(pkgPath, "utf8"));
  const confText = fs.readFileSync(tauriConfPath, "utf8");
  const { text, changed, previous } = syncedTauriConf(confText, version);

  if (!changed) {
    console.log(`tauri.conf.json version already ${version} -- in sync`);
    return 0;
  }
  if (checkOnly) {
    console.error(
      `tauri.conf.json version is ${previous}, package.json is ${version} -- out of sync; run node scripts/sync-tauri-version.mjs`,
    );
    return 1;
  }
  fs.writeFileSync(tauriConfPath, text);
  console.log(`tauri.conf.json version: ${previous} -> ${version}`);
  return 0;
}

// Run only when invoked directly, not when imported by the unit test.
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  process.exit(run(process.argv.includes("--check")));
}
