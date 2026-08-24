/**
 * v2.1 DF-17 -- production GGUF import via `ollama create`.
 *
 * Tests inject a fake OllamaImportPort. Vitest never spawns ollama.
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { OllamaImportPort } from "../../../../core/tuning/orchestrator.js";

export function createOllamaCreatePort(
  spawnFn: typeof spawn = spawn,
): OllamaImportPort {
  return {
    async importGguf(ggufPath: string, name: string): Promise<void> {
      const dir = path.join(tmpdir(), "nexus-ollama-import");
      mkdirSync(dir, { recursive: true });
      const modelfile = path.join(dir, `${name.replace(/[^a-z0-9._-]+/gi, "-")}.Modelfile`);
      writeFileSync(modelfile, `FROM ${ggufPath}\n`, "utf8");
      await new Promise<void>((resolve, reject) => {
        const child = spawnFn("ollama", ["create", name, "-f", modelfile], {
          stdio: "ignore",
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ollama create exited ${code ?? "null"}`));
        });
      });
    },
  };
}
