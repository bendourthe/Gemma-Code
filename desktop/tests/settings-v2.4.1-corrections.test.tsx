import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { SettingsPage } from "../src/pages/settings/SettingsPage";
import type { ArchivedChatsClient } from "../src/pages/settings/ArchivedChatsSettings";
import { createMockFineTuningClient } from "../src/pages/settings/mockFineTuningClient";
import type { TuningHardwareSnapshot } from "../src/pages/settings/fineTuningTypes";

const archivedClient: ArchivedChatsClient = {
  async list() {
    return {
      sessions: [
        {
          pillar: "chatbot" as const,
          id: "archived-chat",
          title: "Archived design chat",
          archivedAt: "2026-08-30T12:00:00.000Z",
          originalParent: "Product",
        },
      ],
      errors: [],
    };
  },
  async restore() {
    return {};
  },
};

describe("v2.4.1 Settings corrections", () => {
  it("keeps archived chats inside Data and removes the standalone tab", async () => {
    render(
      <MemoryRouter initialEntries={["/settings?tab=data"]}>
        <SettingsPage archivedChatsClient={archivedClient} />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("settings-tab-archives")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-data")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived chats" })).toBeInTheDocument();
    expect(await screen.findByText("Archived design chat")).toBeInTheDocument();
  });

  it("maps the legacy archives deep link to Data", async () => {
    render(
      <MemoryRouter initialEntries={["/settings?tab=archives"]}>
        <SettingsPage archivedChatsClient={archivedClient} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("settings-data")).toBeInTheDocument();
    expect(await screen.findByText("Archived design chat")).toBeInTheDocument();
  });

  it("shows an honest detecting state without a synthetic zero VRAM value", () => {
    render(
      <MemoryRouter>
        <SettingsPage initialTab="tuning" hostVramGB={null} hostGpuVendor={null} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Training" })).toBeInTheDocument();
    expect(screen.getByText("Detecting training hardware...")).toBeInTheDocument();
    expect(screen.queryByText(/0 GB VRAM/i)).not.toBeInTheDocument();
  });

  it("passes the live host snapshot into the Training capability check", async () => {
    const client = createMockFineTuningClient({ vramGB: 16, gpuVendor: "nvidia" });
    const status = vi.spyOn(client, "status");
    render(
      <MemoryRouter>
        <SettingsPage
          initialTab="tuning"
          fineTuningClient={client}
          hostVramGB={16}
          hostGpuVendor="nvidia"
        />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(status).toHaveBeenCalledWith({
        hostVramGB: 16,
        gpuVendor: "nvidia",
      } satisfies TuningHardwareSnapshot),
    );
    expect(screen.getByTestId("fine-tuning-provision")).toHaveTextContent(
      "Provision training runtime",
    );
    expect(screen.getByTestId("fine-tuning-hardware")).toHaveTextContent(
      "Detected NVIDIA GPU with 16 GB VRAM.",
    );
  });
});
