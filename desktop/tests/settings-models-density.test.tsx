import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import {
  ModelsSettings,
  MODELS_CARD_PADDING,
  MODELS_HEADER_TO_TABS_GAP,
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
      installed: true,
      source: "registry",
      sizeBytes: 4_400_000_000,
      vramGB: 7,
      license: "Apache-2.0",
      description: "A coding specialist.",
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

describe("Settings Models density (v2.4.2 Phase 5)", () => {
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
    expect(screen.getByTestId("models-row-gemma4:e4b-description")).toHaveTextContent("A compact chat model.");
    expect(screen.getByTestId("models-pills-gemma4:e4b")).toBeInTheDocument();
    expect(screen.getByTestId("models-remove-gemma4:e4b")).toBeInTheDocument();
    expect(screen.getByTestId("models-row-gemma4:e4b-details")).toBeInTheDocument();
    expect(screen.getByTestId("models-compatibility-gemma4:e4b")).toBeInTheDocument();
  });
});
