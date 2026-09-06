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
import type {
  DiskUsageDto,
  ListedModelDto,
} from "../src/pages/settings/modelsTypes";

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
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByTestId("models-disk-summary")).toBeInTheDocument();
    expect(screen.getByTestId("settings-models").textContent).not.toMatch(
      /Catalog\s+[0-9a-f]{8,}/i,
    );
  });

  it("places category tabs one spacing token under the title", async () => {
    render(<ModelsSettings client={denseClient()} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("models-chrome").style.gap).toBe(
      MODELS_HEADER_TO_TABS_GAP,
    );
    expect(
      screen.getByRole("tablist", { name: "Model catalog" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("models-tab-embeddings")).toBeInTheDocument();
  });

  it("compacts cards to three copy lines, one action row, and no Details", async () => {
    render(<ModelsSettings client={denseClient()} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    const row = screen.getByTestId("models-row-gemma4:e4b");
    expect(row.style.padding).toBe(MODELS_CARD_PADDING);
    expect(row.querySelector("details")).toBeNull();
    expect(screen.queryByTestId("models-row-gemma4:e4b-details")).toBeNull();
    expect(screen.queryByText("Details")).toBeNull();
    expect(
      screen.getByTestId("models-row-gemma4:e4b-description").style.minWidth,
    ).toBe("0px");
    expect(
      screen.getByTestId("models-row-gemma4:e4b-description"),
    ).toHaveTextContent("A compact chat model.");
    const facts = screen.getByTestId("models-facts-gemma4:e4b");
    expect(facts.style.flexWrap).toBe("wrap");
    expect(facts.textContent).toMatch(/Requirements:/);
    expect(facts.textContent).toMatch(/Storage \(/);
    expect(facts.textContent).toMatch(/VRAM \(6 GB\)/);
    expect(facts.textContent).toMatch(/Company: Google/);
    expect(screen.getByTestId("models-pills-gemma4:e4b").textContent).toMatch(
      /License: Gemma Terms of Use/,
    );
    expect(row.textContent).not.toContain("Also agentic");
    expect(row.textContent).not.toContain("Backend model:");
    expect(row.textContent).not.toContain("ID: gemma4:e4b");
    expect(screen.getByTestId("models-remove-gemma4:e4b")).toHaveAccessibleName(
      "Remove",
    );
    expect(screen.getByTestId("models-remove-gemma4:e4b").style.color).toBe(
      MODELS_REMOVE_COLOR,
    );
    expect(screen.getByTestId("models-downloaded-gemma4:e4b").style.color).toBe(
      MODELS_DOWNLOADED_COLOR,
    );
    expect(
      screen.getByTestId("models-compatibility-gemma4:e4b"),
    ).toBeInTheDocument();
  });

  it("uses a blue download icon with the Download accessible name", async () => {
    render(<ModelsSettings client={denseClient()} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    const download = await screen.findByTestId(
      "models-install-qwen2.5-coder:7b",
    );
    expect(download).toHaveAccessibleName("Download");
    expect(download.style.color).toBe(MODELS_DOWNLOAD_COLOR);
    expect(download.textContent).toMatch(/Download/i);
  });
});

/**
 * v2.4.6 Phase 6 -- compact three-line cards, no Details accordion.
 */
describe("Settings Models density (v2.4.4 Phase 6)", () => {
  async function mounted() {
    render(<ModelsSettings client={denseClient()} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
  }

  it("puts the search field on the tab row, inside the chrome", async () => {
    await mounted();
    const chrome = screen.getByTestId("models-chrome");
    const search = screen.getByTestId("models-search");
    const tablist = screen.getByRole("tablist", { name: "Model catalog" });
    expect(chrome.contains(search)).toBe(true);
    // Same row container, not a sibling block below it.
    const row = tablist.parentElement as HTMLElement;
    expect(row.contains(search)).toBe(true);
    expect(row.style.display).toBe("flex");
    // Narrow panes wrap rather than scrolling the page sideways.
    expect(row.style.flexWrap).toBe("wrap");
  });

  it("hides the Search label visually but keeps the accessible name", async () => {
    await mounted();
    expect(screen.getByLabelText("Search models")).toBeInTheDocument();
  });

  it("still filters the list from the search field", async () => {
    await mounted();
    fireEvent.change(screen.getByTestId("models-search"), {
      target: { value: "gemma" },
    });
    await waitFor(() =>
      expect(screen.queryByTestId("models-row-qwen2.5-coder:7b")).toBeNull(),
    );
    expect(screen.getByTestId("models-row-gemma4:e4b")).toBeInTheDocument();
  });

  it("lays the card actions out as one centered horizontal row", async () => {
    await mounted();
    const actions = screen.getByTestId("models-actions-gemma4:e4b");
    // As a column the star stacked above the download/delete control and made
    // the grid row taller than the copy beside it.
    expect(actions.style.flexDirection).toBe("row");
    expect(actions.style.alignItems).toBe("center");
    expect(actions.style.justifyContent).toBe("center");
    expect(
      actions.contains(screen.getByTestId("models-favorite-gemma4:e4b")),
    ).toBe(true);
    expect(
      actions.contains(screen.getByTestId("models-remove-gemma4:e4b")),
    ).toBe(true);
  });

  it("hugs card height instead of pinning a minimum", async () => {
    await mounted();
    const row = screen.getByTestId("models-row-gemma4:e4b");
    expect(row.style.minHeight).toBe("");
    expect(row.style.height).toBe("");
  });

  it("fails if Details or the old echo copy returns", async () => {
    await mounted();
    expect(screen.queryByTestId("models-row-gemma4:e4b-details")).toBeNull();
    expect(
      screen.getByTestId("models-row-gemma4:e4b").querySelector("details"),
    ).toBeNull();
    const text = screen.getByTestId("models-row-gemma4:e4b").textContent ?? "";
    expect(text).not.toContain("ID: gemma4:e4b");
    expect(text).not.toContain("Also agentic");
    expect(text).not.toContain("Backend model:");
    expect(text).not.toContain("Best for");
    expect(text).not.toContain("Why this one");
  });

  it("renders pills with the label visually distinct from the value", async () => {
    await mounted();
    const pills = screen.getByTestId("models-pills-gemma4:e4b");
    // The label half only, not the enclosing chip whose text starts the same.
    const label = Array.from(pills.querySelectorAll("span")).find(
      (el) => (el.textContent ?? "").trim() === "License:",
    );
    expect(label).toBeDefined();
    expect((label as HTMLElement).style.color).toBe("var(--fg-muted)");
    const value = (label as HTMLElement)
      .nextElementSibling as HTMLElement | null;
    expect(value).not.toBeNull();
    expect(value!.style.color).toBe("var(--fg-0)");
    expect(value!.textContent).toBe("Gemma Terms of Use");
  });

  it("does not render Best for or Why this one", async () => {
    await mounted();
    expect(screen.queryByTestId("models-row-gemma4:e4b-best-for")).toBeNull();
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    await screen.findByTestId("models-row-qwen2.5-coder:7b");
    expect(
      screen.queryByTestId("models-row-qwen2.5-coder:7b-best-for"),
    ).toBeNull();
    expect(screen.queryByTestId("models-row-qwen2.5-coder:7b-why")).toBeNull();
  });

  it("matches the Gemma 4 12B three-line operator card", async () => {
    const gemmaClient: ModelsClient = {
      catalogHash: "abcdef0123456789".repeat(4),
      async list() {
        return [
          {
            id: "gemma-4-12b-it-gguf",
            displayName: "Gemma 4 12B",
            family: "gemma4",
            type: "llm",
            task: "chat",
            installed: true,
            source: "registry",
            sizeBytes: 8_160_000_000,
            vramGB: 11,
            license: "Gemma Terms of Use",
            origin: "USA",
            agentic: true,
            vision: true,
            modalities: ["text", "image"],
            uncensored: false,
            contextWindow: 262144,
            releaseDate: "2026-05-01",
            description:
              "Google's Gemma 4 12B is a mid-size multimodal agentic model from the USA that can read both text and images. It also has a large enough context window to hold book-length material in a single session.",
          },
        ];
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
    render(<ModelsSettings client={gemmaClient} hostVramGB={16} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("models-header-gemma-4-12b-it-gguf"),
    ).toHaveTextContent("Gemma 4 12B");
    const requirements = screen.getByTestId("models-facts-gemma-4-12b-it-gguf");
    expect(requirements.textContent).toMatch(/Requirements:/);
    expect(requirements.textContent).toMatch(/Storage \(/);
    expect(requirements.textContent).toMatch(/VRAM \(11 GB\)/);
    expect(requirements.textContent).toMatch(/Company: Google/);
    expect(requirements.textContent).toMatch(/Country: USA/);
    expect(requirements.textContent).toMatch(/Released: May 2026/);
    const caps = screen.getByTestId("models-pills-gemma-4-12b-it-gguf");
    expect(caps.textContent).toMatch(/Agentic: Yes/);
    expect(caps.textContent).toMatch(/Context window: 262k tokens/);
    expect(caps.textContent).toMatch(/Multimodal: Yes/);
    expect(caps.textContent).toMatch(/Guardrails: Censored/);
    expect(caps.textContent).toMatch(/License: Gemma Terms of Use/);
    expect(
      screen.getByTestId("models-row-gemma-4-12b-it-gguf-description"),
    ).toHaveTextContent(
      "Google's Gemma 4 12B is a mid-size multimodal agentic model from the USA that can read both text and images. It also has a large enough context window to hold book-length material in a single session.",
    );
    expect(
      screen.queryByTestId("models-row-gemma-4-12b-it-gguf-details"),
    ).toBeNull();
    const actions = screen.getByTestId("models-actions-gemma-4-12b-it-gguf");
    expect(actions.style.flexDirection).toBe("row");
    expect(actions.style.alignItems).toBe("center");
    expect(actions.style.justifyContent).toBe("center");
  });
});
