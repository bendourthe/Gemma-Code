#!/usr/bin/env node
// v0.9.0 Phase 4 sub-task 4.1 -- thin entry point that delegates to the
// shared `cli.mjs` dispatcher with `unit` as the kind. Permits direct
// invocation: `node scripts/debug/unit.mjs [pattern] [--watch] [--verbose]`.

import { main } from "./cli.mjs";

const argv = [process.argv[0], process.argv[1], "unit", ...process.argv.slice(2)];
main(argv).then((code) => process.exit(code ?? 0));
