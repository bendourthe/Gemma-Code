/**
 * Pick the OS backend. Unknown platforms degrade to unconfined.
 */

import { createLinuxLandlockBackend } from "./backends/linuxLandlock.js";
import { createMacosSeatbeltBackend } from "./backends/macosSeatbelt.js";
import { createUnconfinedBackend } from "./backends/unconfined.js";
import { createWindowsJobBackend } from "./backends/windowsJob.js";
import { NONE_CAPABILITY } from "./report.js";
import type { SandboxBackend } from "./types.js";

export function selectSandboxBackend(
  platform: NodeJS.Platform = process.platform,
): SandboxBackend {
  if (platform === "darwin") return createMacosSeatbeltBackend();
  if (platform === "linux") return createLinuxLandlockBackend();
  if (platform === "win32") return createWindowsJobBackend();
  return createUnconfinedBackend({
    ...NONE_CAPABILITY,
    platform,
    detail: `no sandbox backend for platform ${platform}`,
  });
}
