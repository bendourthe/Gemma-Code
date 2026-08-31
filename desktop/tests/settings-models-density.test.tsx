import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  ModelsSettings,
  MODELS_CARD_PADDING,
  MODELS_DOWNLOAD_COLOR,
  MODELS_DOWNLOADED_COLOR,
  MODELS_HEADER_TO_TABS_GAP,
  MODELS_REMOVE_COLOR,
  type ModelsClient,
} from "../src/pages/settings/ModelsSettings";
import type { DiskUsageDto, ListedModelDto } from "../src/pages/settings/modelsTypes";

function diskUsage(): DiskUsageDto {
  return {
    usedBytes: 2_700_000_000,
    modelBytes: 2_700_000_000,
    freeBytes: 500_000_000_000,
    capacityBytes: 502_700_000_000,
    measurementPath: "C:\\Users\\test\\.nexus\\models",
    measuredAt: "2026-08-29T00:00:00.000Z",
  };
}

function items(): ListedModelDto[] {
  return [
    {
      id: "gemma4:e4b",
      displayName: "Gemma 4 E4B",
      family: "gemma4",
      tag: "e4b",
      type: "llm",
      task: "chat",
      installed: true,
      source: "registry",
      sizeBytes: 2_700_000_000,
      vramGB: 6,
      license: "Gemma Terms of Use",
      description: "A compact chat model.",
      strengths: ["Everyday questions", "Laptop GPUs"],
      tags: ["recommended"],
    },
    {
      id: "qwen2.5-coder:7b",
      displayName: "Qwen 2.5 Coder 7B",
      family: "qwen",
      tag: "7b",
      type: "llm",
      task: "agentic",
      installed: false,
      source: "catalog-only",
      sizeBytes: 4_400_000_000,
      vramGB: 7,
      license: "Apache-2.0",
      description: "A coding specialist.",
      origin: "China",
    },
  ];
}

function denseClient(): ModelsClient {
  return {
    catalogHash: "abcdef0123456789".repeat(4),
    async list() {
      return items();
    },
    install() {
      return { cancel() {}, done: Promise.resolve() };
    },
    async remove() {},
    reveal() {},
    async diskUsage() {
      return diskUsage();
    },
  };
}

describe("Settings Models density (v2.4.3 Phase 4)", () => {
  it("keeps title and disk summary without a catalog fingerprint", async () => {
    render(<ModelsSettings client={denseClient()} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByTestId("models-disk-summary")).toBeInTheDocument();
    expect(screen.getByTestId("settings-models").textContent).not.toMatch(/Catalog\s+[0-9a-f]{8,}/i);
  });

  it("places category tabs one spacing token under the title", async () => {
    render(<ModelsSettings client={denseClient()} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("models-chrome").style.gap).toBe(MODELS_HEADER_TO_TABS_GAP);
    expect(screen.getByRole("tablist", { name: "Model catalog" })).toBeInTheDocument();
    expect(screen.getByTestId("models-tab-embeddings")).toBeInTheDocument();
  });

  it("compacts cards without dropping description, pills, Remove, or Details", async () => {
    render(<ModelsSettings client={denseClient()} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    const row = screen.getByTestId("models-row-gemma4:e4b");
    expect(row.style.padding).toBe(MODELS_CARD_PADDING);
    expect(screen.getByTestId("models-row-gemma4:e4b-description").style.minWidth).toBe("0px");
    expect(screen.getByTestId("models-row-gemma4:e4b-description")).toHaveTextContent("A compact chat model.");
    const facts = screen.getByTestId("models-facts-gemma4:e4b");
    expect(facts.style.flexWrap).toBe("nowrap");
    expect(facts.textContent).not.toMatch(/Company:|License:|Context window:/);
    const details = screen.getByTestId("models-row-gemma4:e4b-details");
    expect(details.contains(screen.getByTestId("models-pills-gemma4:e4b"))).toBe(true);
    expect(screen.getByTestId("models-remove-gemma4:e4b")).toHaveAccessibleName("Remove");
    expect(screen.getByTestId("models-remove-gemma4:e4b").style.color).toBe(MODELS_REMOVE_COLOR);
    expect(screen.getByTestId("models-downloaded-gemma4:e4b").style.color).toBe(MODELS_DOWNLOADED_COLOR);
    expect(screen.getByTestId("models-compatibility-gemma4:e4b")).toBeInTheDocument();
  });

  it("uses a blue download icon with the Download accessible name", async () => {
    render(<ModelsSettings client={denseClient()} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    const download = await screen.findByTestId("models-install-qwen2.5-coder:7b");
    expect(download).toHaveAccessibleName("Download");
    expect(download.style.color).toBe(MODELS_DOWNLOAD_COLOR);
    expect(download.textContent).toMatch(/Download/i);
  });
});
