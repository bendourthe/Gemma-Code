#!/usr/bin/env node
// Deterministic generator for large.ts. Produces a ~200 KB file with
// 20,000 single-line featureFlag<i>() functions; featureFlag17500 carries
// a unique marker phrase ("performance gate") so the task can grep for it.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "large.ts");

// 1500 single-line functions @ ~75 bytes each ~= 110 KB; well above the
// 64 KB Phase 1 truncation cap, but small enough to commit cleanly.
const lines = ["// Auto-generated. Regenerate via _setup.mjs."];
const TARGET = 1300;
for (let i = 0; i < 1500; i++) {
  const tag = i === TARGET ? "performance" : "flag";
  lines.push(
    `export function featureFlag${i}(x:number):number{return((x+${i})*31)%1009;/*${tag}*/}`,
  );
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(`generated ${out}`);
