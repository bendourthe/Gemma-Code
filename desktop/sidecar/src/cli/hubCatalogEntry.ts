// v2.2.0 Phase 3 (3.1) -- dedicated headless entry point for hub-catalog work.
//
// Deliberately SEPARATE from `main.ts`: that module starts the agent-run
// scheduler, binds the serving gateway, and opens the studio database as
// module-level side effects. An installer invoking a one-shot catalog sync
// must not do any of that, so the installer calls this bundle instead:
//
//   node hub-catalog.js --sync-hub-catalog [--tag vX.Y.Z]
//   node hub-catalog.js --extract-hub-snapshot <archive.tar.gz> --sha256 <hex>
//   node hub-catalog.js --hub-catalog-status
//
// Emits newline-delimited JSON events on stdout; exits nonzero on failure.

import { runHubCatalogCli } from "./hubCatalogCli.js";

void runHubCatalogCli(process.argv).then(
  (code) => {
    if (code === null) {
      process.stdout.write(
        `${JSON.stringify({
          kind: "error",
          ok: false,
          failureClass: "unknown",
          message: "no hub-catalog mode requested",
        })}\n`,
      );
      process.exit(2);
    }
    process.exit(code);
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      `${JSON.stringify({ kind: "error", ok: false, failureClass: "unknown", message })}\n`,
    );
    process.exit(1);
  },
);
