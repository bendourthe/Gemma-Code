import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { VIDEO_ENHANCEMENT_SUPPORT } from "../../core/video/videoEnhancementSupport";
import { SettingsPage } from "../src/pages/settings/SettingsPage";
import { VideoSettings } from "../src/pages/settings/VideoSettings";
import { createMockVideoSettingsClient } from "../src/pages/settings/mockVideoSettingsClient";

describe("VideoSettings", () => {
  it("saves an absolute path and shows the shared setup copy", async () => {
    const user = userEvent.setup();
    const client = createMockVideoSettingsClient();
    render(<VideoSettings client={client} />);
    expect(
      screen.getByText(VIDEO_ENHANCEMENT_SUPPORT.setupCopy),
    ).toBeInTheDocument();
    await user.type(
      screen.getByTestId("video-settings-path"),
      "/opt/video2x/video2x",
    );
    await user.click(screen.getByTestId("video-settings-save"));
    expect(
      await screen.findByText("Saved the Video2X executable path."),
    ).toBeInTheDocument();
    expect(await client.getPath()).toMatchObject({
      settingPath: "/opt/video2x/video2x",
      configurationSource: "setting",
    });
  });

  it("surfaces a load error from the sidecar", async () => {
    render(
      <VideoSettings
        client={{
          async getPath() {
            throw new Error("backend unreachable");
          },
          async setPath() {
            throw new Error("save failed");
          },
        }}
      />,
    );
    expect(await screen.findByTestId("video-settings-error")).toHaveTextContent(
      "backend unreachable",
    );
  });

  it("explains when the environment override wins", async () => {
    render(
      <VideoSettings
        client={createMockVideoSettingsClient({
          settingPath: "/opt/video2x/video2x",
          envPath: "/opt/video2x/video2x",
          configurationSource: "environment",
        })}
      />,
    );
    expect(
      await screen.findByTestId("video-settings-env-override"),
    ).toHaveTextContent(VIDEO_ENHANCEMENT_SUPPORT.envWinsCopy);
  });

  it("surfaces a save error", async () => {
    const user = userEvent.setup();
    render(
      <VideoSettings
        client={{
          async getPath() {
            return {
              settingPath: null,
              envPath: null,
              configurationSource: null,
            };
          },
          async setPath() {
            throw new Error("save failed");
          },
        }}
      />,
    );
    await user.click(screen.getByTestId("video-settings-save"));
    expect(await screen.findByTestId("video-settings-error")).toHaveTextContent(
      "save failed",
    );
  });
});

describe("SettingsPage Video tab", () => {
  it("opens the Video tab from the query string", () => {
    render(
      <MemoryRouter initialEntries={["/settings?tab=video"]}>
        <SettingsPage initialTab="models" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("settings-video")).toBeInTheDocument();
  });
});
