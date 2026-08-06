/**
 * v1.15.0 Phase 7 (Issue 6) -- guard the quick packaging path.
 *
 * `npm run package:quick` runs `vsce package` directly, which SKIPS the
 * `@electron/rebuild` step that `npm run package` performs. A VSIX built that
 * way ships a `better-sqlite3` compiled for Node's ABI rather than VS Code's
 * Electron ABI; loading it throws a NODE_MODULE_VERSION error during activation,
 * which is what produced the reported "command 'nexus.coding.newChat' not found"
 * plus forever-loading sidebar views.
 *
 * The quick path stays available for local dev iteration, but it now warns
 * loudly and refuses to run for a release build (NEXUS_RELEASE=1 or --release),
 * so a release VSIX can only come from the full pipeline.
 */

const isRelease =
  process.env.NEXUS_RELEASE === "1" ||
  process.env.CI === "true" ||
  process.argv.includes("--release");

const BANNER = [
  "",
  "  package:quick SKIPS the Electron native-module rebuild.",
  "  The resulting VSIX may fail to activate on a real VS Code install",
  "  (better-sqlite3 NODE_MODULE_VERSION mismatch).",
  "",
  "  Use `npm run package` for anything you intend to install or ship.",
  "",
].join("\n");

if (isRelease) {
  console.error(`ERROR: package:quick is not allowed for a release build.${BANNER}`);
  process.exit(1);
}

console.warn(`WARNING: local dev build only.${BANNER}`);
