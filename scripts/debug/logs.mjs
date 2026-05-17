#!/usr/bin/env node
// v0.9.0 Phase 4 sub-task 4.1 -- delegates to `cli.mjs logs ...`.

import { main } from "./cli.mjs";

const argv = [process.argv[0], process.argv[1], "logs", ...process.argv.slice(2)];
main(argv).then((code) => process.exit(code ?? 0));
