/**
 * v2.3.0 Phase 5 -- in-memory Video settings client for local tests.
 */

import type { Video2xPathDto, VideoSettingsClient } from "./videoSettingsTypes";

export function createMockVideoSettingsClient(
  initial: Partial<Video2xPathDto> = {},
): VideoSettingsClient {
  let snapshot: Video2xPathDto = {
    settingPath: initial.settingPath ?? null,
    envPath: initial.envPath ?? null,
    configurationSource: initial.configurationSource ?? null,
  };

  return {
    async getPath(): Promise<Video2xPathDto> {
      return snapshot;
    },
    async setPath(path: string): Promise<Video2xPathDto> {
      const trimmed = path.trim();
      snapshot = {
        settingPath: trimmed.length > 0 ? trimmed : null,
        envPath: snapshot.envPath,
        configurationSource: snapshot.envPath
          ? "environment"
          : trimmed.length > 0
            ? "setting"
            : null,
      };
      return snapshot;
    },
  };
}
