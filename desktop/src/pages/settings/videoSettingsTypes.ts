/**
 * v2.3.0 Phase 5 -- Settings > Video, optional Video2X executable path.
 */

export interface Video2xPathDto {
  settingPath: string | null;
  envPath: string | null;
  configurationSource: "environment" | "setting" | null;
}

export interface VideoSettingsClient {
  getPath(): Promise<Video2xPathDto>;
  setPath(path: string): Promise<Video2xPathDto>;
}
