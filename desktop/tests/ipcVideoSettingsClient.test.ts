import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcCall = vi.fn();

vi.mock("../src/lib/ipc", () => ({
  ipcCall: (...args: unknown[]) => ipcCall(...args),
}));

import { createIpcVideoSettingsClient } from "../src/pages/settings/ipcVideoSettingsClient";

describe("createIpcVideoSettingsClient", () => {
  beforeEach(() => {
    ipcCall.mockReset();
  });

  it("returns the path snapshot when the sidecar succeeds", async () => {
    ipcCall.mockResolvedValue({
      ok: true,
      value: {
        settingPath: "/opt/video2x/video2x",
        envPath: null,
        configurationSource: "setting",
      },
    });
    const client = createIpcVideoSettingsClient();
    await expect(client.getPath()).resolves.toMatchObject({
      settingPath: "/opt/video2x/video2x",
      configurationSource: "setting",
    });
    expect(ipcCall).toHaveBeenCalledWith("video.video2xPath.get", {});
  });

  it("saves a path and surfaces sidecar errors", async () => {
    ipcCall
      .mockResolvedValueOnce({
        ok: true,
        value: {
          settingPath: "/opt/video2x/video2x",
          envPath: null,
          configurationSource: "setting",
        },
      })
      .mockResolvedValueOnce({ ok: false, message: "sidecar down" });
    const client = createIpcVideoSettingsClient();
    await expect(client.setPath("/opt/video2x/video2x")).resolves.toMatchObject({
      settingPath: "/opt/video2x/video2x",
    });
    await expect(client.getPath()).rejects.toThrow("sidecar down");
  });
});
