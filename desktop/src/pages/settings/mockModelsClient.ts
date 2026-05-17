/**
 * v1.0.0 Phase 5.5 -- in-process mock for the Settings models page.
 *
 * Used by the default `SettingsPage` route until the sidecar's IPC surface
 * (`models.list` / `models.install` / `models.remove` / `models.diskUsage`)
 * is wired in Phase 5.5 follow-on. Tests inject a different client.
 */

import type {
  DiskUsageDto,
  InstallProgressDto,
  ListedModelDto,
} from "./modelsTypes";
import type { InstallHandle, ModelsClient } from "./ModelsSettings";

const SAMPLE: ListedModelDto[] = [
  {
    id: "gemma4:e4b",
    displayName: "Gemma 4 E4B",
    family: "gemma4",
    tag: "e4b",
    type: "llm",
    installed: true,
    source: "registry",
    sizeBytes: 2_700_000_000,
    vramGB: 6,
    license: "Gemma Terms of Use",
    tags: ["recommended"],
  },
  {
    id: "qwen2.5-coder:7b",
    displayName: "Qwen 2.5 Coder 7B",
    family: "qwen",
    tag: "7b",
    type: "llm",
    installed: false,
    source: "catalog-only",
    sizeBytes: 4_400_000_000,
    vramGB: 7,
    license: "Apache-2.0",
    tags: ["recommended"],
  },
  {
    id: "sdxl-turbo",
    displayName: "SDXL Turbo",
    family: "sdxl",
    tag: "fp16",
    type: "image",
    installed: false,
    source: "catalog-only",
    sizeBytes: 6_900_000_000,
    vramGB: 8,
    license: "Stability AI Non-Commercial",
  },
];

export function createMockModelsClient(): ModelsClient {
  const items = [...SAMPLE];

  return {
    async list() {
      return items;
    },
    install(id, onProgress) {
      let cancelled = false;
      const done = new Promise<void>((resolve, reject) => {
        const totalBytes = items.find((m) => m.id === id)?.sizeBytes ?? 1_000_000;
        let bytes = 0;
        const step = Math.max(50_000, Math.round(totalBytes / 10));
        const timer = setInterval(() => {
          if (cancelled) {
            clearInterval(timer);
            reject(new Error("cancelled"));
            return;
          }
          bytes = Math.min(totalBytes, bytes + step);
          const event: InstallProgressDto = { id, bytes, total: totalBytes };
          onProgress(event);
          if (bytes >= totalBytes) {
            clearInterval(timer);
            const target = items.find((m) => m.id === id);
            if (target) {
              target.installed = true;
              (target as { source: ListedModelDto["source"] }).source = "registry";
            }
            resolve();
          }
        }, 80);
      });
      const handle: InstallHandle = {
        cancel() {
          cancelled = true;
        },
      };
      return Object.assign(handle, { done });
    },
    async remove(id) {
      const idx = items.findIndex((m) => m.id === id);
      if (idx >= 0) {
        items[idx] = {
          ...items[idx],
          installed: false,
          source: "catalog-only",
        } as ListedModelDto;
      }
    },
    async diskUsage(): Promise<DiskUsageDto> {
      const used = items
        .filter((m) => m.installed && m.source === "registry")
        .reduce((acc, m) => acc + (m.sizeBytes ?? 0), 0);
      return { usedBytes: used, freeBytes: 250_000_000_000 };
    },
  };
}
