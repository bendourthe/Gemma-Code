import { describe, expect, it } from "vitest";

import { InMemorySettingsStore } from "../../core/storage/SettingsStore";
import {
  VIDEO2X_ENV_KEY,
  VIDEO2X_SETTING_KEY,
} from "../../core/video/index.js";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";

const ABSOLUTE =
  process.platform === "win32"
    ? "C:\\Video2X\\video2x.exe"
    : "/opt/video2x/video2x";

describe("video.video2xPath settings IPC", () => {
  it("persists an absolute setting and reports env override", async () => {
    const settings = new InMemorySettingsStore();
    const ctx = createHandlerContext({ pid: 1, platform: process.platform });
    ctx.settings = settings;
    const previous = process.env[VIDEO2X_ENV_KEY];
    try {
      delete process.env[VIDEO2X_ENV_KEY];
      const empty = (await dispatch("video.video2xPath.get", {}, ctx)) as {
        configurationSource: string | null;
      };
      expect(empty.configurationSource).toBeNull();

      const saved = (await dispatch(
        "video.video2xPath.set",
        { path: ABSOLUTE },
        ctx,
      )) as { settingPath: string; configurationSource: string };
      expect(saved.settingPath).toBe(ABSOLUTE);
      expect(saved.configurationSource).toBe("setting");
      expect(await settings.get<string>(VIDEO2X_SETTING_KEY)).toBe(ABSOLUTE);

      process.env[VIDEO2X_ENV_KEY] = ABSOLUTE;
      const envWins = (await dispatch("video.video2xPath.get", {}, ctx)) as {
        configurationSource: string;
        envPath: string;
      };
      expect(envWins.configurationSource).toBe("environment");
      expect(envWins.envPath).toBe(ABSOLUTE);
    } finally {
      if (previous === undefined) delete process.env[VIDEO2X_ENV_KEY];
      else process.env[VIDEO2X_ENV_KEY] = previous;
    }
  });

  it("rejects a relative path", async () => {
    const ctx = createHandlerContext({ pid: 1, platform: process.platform });
    ctx.settings = new InMemorySettingsStore();
    await expect(
      dispatch("video.video2xPath.set", { path: "video2x" }, ctx),
    ).rejects.toThrow(/absolute local file path/);
  });
});
