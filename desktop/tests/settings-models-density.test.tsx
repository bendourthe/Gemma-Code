import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  ModelsSettings,
  MODELS_CARD_PADDING,
  MODELS_DOWNLOAD_COLOR,
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
    // v2.4.8 Phase 4 (T016): installer name-row grammar. No Requirements row;
    // the size is a pill in the provider color and compatibility is a round
    // badge whose wording is the tooltip.
    expect(screen.queryByTestId("models-facts-gemma4:e4b")).toBeNull();
    const header = screen.getByTestId("models-header-gemma4:e4b");
    expect(header.style.flexWrap).toBe("wrap");
    expect(header.textContent).toMatch(/Company: Google/);
    expect(screen.getByTestId("models-pills-gemma4:e4b").textContent).toMatch(
      /License: Gemma Terms of Use/,
    );
    expect(screen.getByTestId("models-size-gemma4:e4b").style.color).toBe(
      "rgb(34, 211, 238)",
    );
    // v2.4.8 Phase 7: no compatibility checkmark; size then delete.
    expect(screen.queryByTestId("models-compat-badge-gemma4:e4b")).toBeNull();
    const cluster = screen.getByTestId("models-badges-gemma4:e4b");
    expect(cluster.children[0]).toBe(screen.getByTestId("models-size-gemma4:e4b"));
    expect(cluster.contains(screen.getByTestId("models-remove-gemma4:e4b"))).toBe(true);
    expect(row.textContent).not.toContain("Also agentic");
    expect(row.textContent).not.toContain("Backend model:");
    expect(row.textContent).not.toContain("ID: gemma4:e4b");
    expect(screen.getByTestId("models-remove-gemma4:e4b")).toHaveAccessibleName(
      "Remove",
    );
    expect(screen.getByTestId("models-remove-gemma4:e4b").style.color).toBe(
      MODELS_REMOVE_COLOR,
    );
    // v2.4.8 Phase 7: the delete button alone marks a downloaded row.
    expect(screen.queryByTestId("models-downloaded-gemma4:e4b")).toBeNull();
    expect(screen.queryByTestId("models-downloaded-badge-gemma4:e4b")).toBeNull();
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

  it("renders no action row under the body; the title row carries the action", async () => {
    await mounted();
    // v2.4.8 Phase 7 (T034): the star and the centered action row are gone.
    expect(screen.queryByTestId("models-actions-gemma4:e4b")).toBeNull();
    expect(screen.queryByTestId("models-favorite-gemma4:e4b")).toBeNull();
    const cluster = screen.getByTestId("models-badges-gemma4:e4b");
    expect(
      cluster.contains(screen.getByTestId("models-remove-gemma4:e4b")),
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
  });

  // v2.4.8 Phase 4 (T016): installer `_pill` is one color at caption size with
  // a 9 px radius. The v2.4.4 label / value split is gone for parity.
  it("renders pills as one-color installer chips", async () => {
    await mounted();
    const pills = screen.getByTestId("models-pills-gemma4:e4b");
    const license = Array.from(pills.children).find((el) =>
      (el.textContent ?? "").startsWith("License:"),
    ) as HTMLElement | undefined;
    expect(license).toBeDefined();
    expect(license!.textContent).toBe("License: Gemma Terms of Use");
    expect(license!.children.length).toBe(0);
    expect(license!.style.color).toBe("var(--fg-muted)");
    expect(license!.style.borderRadius).toBe("9px");
    expect(license!.style.padding).toBe("1px 8px");
    expect(license!.style.fontSize).toBe("var(--text-xs, 12px)");
  });

  // v2.4.8 Phase 4 (T016): Best for and Why this one return, exactly as the
  // installer card prints them, when the catalog row carries the data. The
  // dense Gemma fixture carries strengths but no whyRecommended, so the card
  // prints Best for and omits Why this one.
  it("renders Best for and Why this one only when the row carries them", async () => {
    await mounted();
    expect(
      screen.getByTestId("models-row-gemma4:e4b-best-for").textContent,
    ).toBe("Best for: Everyday questions, Laptop GPUs");
    expect(screen.queryByTestId("models-row-gemma4:e4b-why")).toBeNull();
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
    // v2.4.8 Phase 4 (T016): the installer name row. Every fact pill follows
    // the name in the locked v2.2.9 order; size and compatibility sit on the
    // right as a provider-colored pill and a round badge.
    expect(screen.queryByTestId("models-facts-gemma-4-12b-it-gguf")).toBeNull();
    const caps = screen.getByTestId("models-pills-gemma-4-12b-it-gguf");
    expect(Array.from(caps.children).map((c) => c.textContent)).toEqual([
      "Company: Google",
      "Country: USA",
      "Agentic: Yes",
      "Context window: 262k tokens",
      "Multimodal: Yes",
      "Guardrails: Censored",
      "License: Gemma Terms of Use",
      "Released: May 2026",
    ]);
    expect(
      screen.getByTestId("models-header-gemma-4-12b-it-gguf").contains(caps),
    ).toBe(true);
    expect(
      screen.queryByTestId("models-compat-badge-gemma-4-12b-it-gguf"),
    ).toBeNull();
    expect(screen.getByTestId("models-size-gemma-4-12b-it-gguf").textContent).toMatch(
      /GB$/,
    );
    const row = screen.getByTestId("models-row-gemma-4-12b-it-gguf");
    expect(row.getAttribute("data-provider-color")).toBe("#22d3ee");
    expect(row.style.background).toBe(
      "color-mix(in srgb, rgb(34, 211, 238) 9%, transparent)",
    );
    expect(row.style.border).toBe(
      "1px solid color-mix(in srgb, rgb(34, 211, 238) 30%, transparent)",
    );
    expect(row.style.borderRadius).toBe("8px");
    expect(
      screen.getByTestId("models-row-gemma-4-12b-it-gguf-description"),
    ).toHaveTextContent(
      "Google's Gemma 4 12B is a mid-size multimodal agentic model from the USA that can read both text and images. It also has a large enough context window to hold book-length material in a single session.",
    );
    expect(
      screen.queryByTestId("models-row-gemma-4-12b-it-gguf-details"),
    ).toBeNull();
    expect(screen.queryByTestId("models-actions-gemma-4-12b-it-gguf")).toBeNull();
    expect(
      screen
        .getByTestId("models-badges-gemma-4-12b-it-gguf")
        .contains(screen.getByTestId("models-remove-gemma-4-12b-it-gguf")),
    ).toBe(true);
  });
});
