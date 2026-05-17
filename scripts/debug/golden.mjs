#!/usr/bin/env node
// v0.9.0 Phase 4 sub-task 4.1 -- delegates to `cli.mjs` with `golden`.

import { main } from "./cli.mjs";

const argv = [process.argv[0], process.argv[1], "golden", ...process.argv.slice(2)];
main(argv).then((code) => process.exit(code ?? 0));
