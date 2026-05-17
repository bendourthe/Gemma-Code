#!/usr/bin/env node
/**
 * nexus-image CLI (Phase 6.6).
 *
 * Currently exposes one subcommand:
 *
 *   nexus-image extract-workflow <file.png>
 *
 * Reads the named PNG, looks for a Nexus workflow tEXt chunk (or the
 * ComfyUI `workflow` compat alias), and prints the JSON to stdout. Exits
 * 0 on success, 1 if the file does not embed a workflow, 2 on argument
 * or I/O errors.
 *
 * The implementation lives at `core/image/WorkflowMetadata.ts` and is
 * compiled to `out/core/image/WorkflowMetadata.js` by `npm run build`.
 * To keep this CLI runnable from a source checkout without a TS build
 * step, the script falls back to an inline port of `extractWorkflow`
 * when the compiled module is absent.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadExtractor() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "image", "WorkflowMetadata.js");
  if (existsSync(compiled)) {
    return (await import(compiled)).extractWorkflow;
  }
  return inlineExtract;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_CHUNK_TYPE = "tEXt";

function inlineExtract(buffer) {
  if (buffer.length < PNG_SIGNATURE.length) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) return null;
  }
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.toString("latin1", offset, offset + 4);
    offset += 4;
    if (offset + length + 4 > buffer.length) return null;
    chunks.push({ type, data: buffer.subarray(offset, offset + length) });
    offset += length + 4;
    if (type === "IEND") break;
  }
  for (const key of ["nexus_workflow", "workflow"]) {
    for (const chunk of chunks) {
      if (chunk.type !== TEXT_CHUNK_TYPE) continue;
      const nullIndex = chunk.data.indexOf(0);
      if (nullIndex < 0) continue;
      const chunkKey = chunk.data.subarray(0, nullIndex).toString("latin1");
      if (chunkKey !== key) continue;
      try {
        const parsed = JSON.parse(chunk.data.subarray(nullIndex + 1).toString("utf8"));
        if (
          parsed &&
          typeof parsed === "object" &&
          ["txt2img", "img2img", "inpaint", "outpaint"].includes(parsed.mode)
        ) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

function usage() {
  process.stderr.write("usage: nexus-image extract-workflow <file.png>\n");
  process.exit(2);
}

async function main() {
  const [, , subcommand, fileArg] = process.argv;
  if (subcommand === "--help" || subcommand === "-h") {
    process.stdout.write("usage: nexus-image extract-workflow <file.png>\n");
    return 0;
  }
  if (subcommand !== "extract-workflow" || !fileArg) {
    usage();
    return 2;
  }
  let buffer;
  try {
    buffer = readFileSync(fileArg);
  } catch (err) {
    process.stderr.write(`nexus-image: cannot read ${fileArg}: ${err && err.message ? err.message : err}\n`);
    return 2;
  }
  const extract = await loadExtractor();
  const workflow = extract(buffer);
  if (!workflow) {
    process.stderr.write(`nexus-image: no workflow metadata found in ${fileArg}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(workflow, null, 2) + "\n");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`nexus-image: ${err && err.stack ? err.stack : err}\n`);
    process.exit(2);
  });
