import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";

import {
  ModelsSettings,
  type ModelsClient,
  type InstallHandle,
} from "../src/pages/settings/ModelsSettings";
import type {
  DiskUsageDto,
  InstallProgressDto,
  ListedModelDto,
} from "../src/pages/settings/modelsTypes";

function diskUsage(overrides: Partial<DiskUsageDto> = {}): DiskUsageDto {
  return {
    usedBytes: 0,
    modelBytes: 0,
    freeBytes: null,
    capacityBytes: null,
    measurementPath: "C:\\Users\\test\\.nexus\\models",
    measuredAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function makeItems(): ListedModelDto[] {
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
      strengths: ["Repo edits", "Tool use"],
    },
    {
      id: "ltx-video",
      displayName: "LTX-Video",
      family: "ltx",
      tag: "0.9",
      type: "video",
      task: "video",
      installed: false,
      source: "catalog-only",
      sizeBytes: 13_000_000_000,
      vramGB: 12,
      license: "OpenRAIL-M",
    },
    {
      id: "external:comfyui:checkpoints:dreamshaper",
      displayName: "dreamshaper.safetensors",
      family: "checkpoints",
      installed: true,
      source: "external",
      absPath: "/abs/dreamshaper.safetensors",
      sizeBytes: 6_000_000_000,
    },
  ];
}

function client(): {
  client: ModelsClient;
  events: {
    install: string[];
    remove: string[];
    reveal: string[];
    progress: InstallProgressDto[];
  };
  state: { items: ListedModelDto[] };
  resolveInstall(id: string): void;
  rejectInstall(id: string, message: string): void;
} {
  const events = {
    install: [] as string[],
    remove: [] as string[],
    reveal: [] as string[],
    progress: [] as InstallProgressDto[],
  };
  const state = { items: makeItems() };
  const pendingResolvers = new Map<
    string,
    (v: void | PromiseLike<void>) => void
  >();
  const pendingRejectors = new Map<string, (e: Error) => void>();
  const c: ModelsClient = {
    async list() {
      return state.items;
    },
    install(id, onProgress) {
      events.install.push(id);
      const done = new Promise<void>((resolve, reject) => {
        pendingResolvers.set(id, resolve);
        pendingRejectors.set(id, reject);
      });
      const handle: InstallHandle = {
        cancel() {
          pendingResolvers.get(id)?.();
          pendingResolvers.delete(id);
          pendingRejectors.delete(id);
        },
      };
      onProgress({ id, bytes: 100, total: 1000 });
      events.progress.push({ id, bytes: 100, total: 1000 });
      return Object.assign(handle, { done });
    },
    async remove(id) {
      events.remove.push(id);
      const target = state.items.find((m) => m.id === id);
      if (target) {
        target.installed = false;
        (target as { source: ListedModelDto["source"] }).source =
          "catalog-only";
      }
    },
    reveal(p) {
      events.reveal.push(p);
    },
    async diskUsage() {
      return diskUsage({
        usedBytes: 2_700_000_000,
        modelBytes: 2_700_000_000,
        freeBytes: 500_000_000_000,
        capacityBytes: 502_700_000_000,
      });
    },
  };
  return {
    client: c,
    events,
    state,
    resolveInstall(id: string) {
      const target = state.items.find((m) => m.id === id);
      if (target) {
        target.installed = true;
        (target as { source: ListedModelDto["source"] }).source = "registry";
      }
      pendingResolvers.get(id)?.();
      pendingResolvers.delete(id);
      pendingRejectors.delete(id);
    },
    rejectInstall(id: string, message: string) {
      pendingRejectors.get(id)?.(new Error(message));
      pendingResolvers.delete(id);
      pendingRejectors.delete(id);
    },
  };
}

async function loaded(
  ui: ReturnType<typeof client>,
  props: { hostVramGB?: number | null } = {},
) {
  render(<ModelsSettings client={ui.client} hostVramGB={props.hostVramGB} />);
  await waitFor(() =>
    expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
  );
}

describe("ModelsSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders installer-parity catalog tabs after loading, Embeddings first", async () => {
    await loaded(client());
    for (const id of [
      "embeddings",
      "chat",
      "agentic",
      "image",
      "video",
      "audio",
      "document",
    ]) {
      expect(screen.getByTestId(`models-tab-${id}`)).toBeInTheDocument();
    }
    // v2.2.9 Phase 5 (T010): Embeddings precedes Chat in the tab strip.
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.indexOf("Embeddings")).toBe(0);
    expect(tabs.indexOf("Embeddings")).toBeLessThan(tabs.indexOf("Chat"));
    expect(screen.getByTestId("models-tab-other")).toBeInTheDocument();
    expect(screen.getByTestId("models-panel-chat")).toBeInTheDocument();
    expect(screen.getByTestId("models-row-gemma4:e4b")).toBeInTheDocument();
    expect(
      screen.queryByTestId("models-row-qwen2.5-coder:7b"),
    ).not.toBeInTheDocument();
  });

  it("labels downloaded, available, and incompatible groups in display order", async () => {
    const ctx = client();
    ctx.state.items = [
      {
        id: "downloaded",
        displayName: "Downloaded",
        type: "llm",
        task: "chat",
        installed: true,
        source: "registry",
        vramGB: 8,
      },
      {
        id: "available",
        displayName: "Available",
        type: "llm",
        task: "chat",
        installed: false,
        source: "catalog-only",
        vramGB: 8,
      },
      {
        id: "incompatible",
        displayName: "Incompatible",
        type: "llm",
        task: "chat",
        installed: false,
        source: "catalog-only",
        vramGB: 24,
      },
    ];
    render(
      <ModelsSettings client={ctx.client} hostVramGB={16} gpuVendor="nvidia" />,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );

    const list = screen.getByTestId("models-list");
    expect(Array.from(list.children).map((child) => child.textContent)).toEqual(
      [
        // v2.4.8 Phase 7: each heading is a chevron toggle with a row count.
        "Downloaded1",
        expect.stringContaining("Downloaded"),
        "Compatible1",
        expect.stringContaining("Available"),
        "Incompatible1",
        expect.stringContaining("Incompatible"),
      ],
    );
  });

  it("refreshes disk usage on focus only while the page is visible", async () => {
    const ctx = client();
    const diskUsage = vi.spyOn(ctx.client, "diskUsage");
    await loaded(ctx);
    await waitFor(() => expect(diskUsage).toHaveBeenCalledTimes(1));

    fireEvent.focus(window);
    await waitFor(() => expect(diskUsage).toHaveBeenCalledTimes(2));

    const visibilityState = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    try {
      fireEvent.focus(window);
      await Promise.resolve();
      expect(diskUsage).toHaveBeenCalledTimes(2);
    } finally {
      if (visibilityState)
        Object.defineProperty(document, "visibilityState", visibilityState);
      else Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("shows Downloaded for catalog id gemma-4-12b-it-gguf when the probe marked it installed", async () => {
    const ctx = client();
    ctx.state.items = [
      {
        id: "gemma-4-12b-it-gguf",
        displayName: "Gemma 4 12B",
        family: "gemma4",
        type: "llm",
        task: "chat",
        installed: true,
        source: "registry",
        vramGB: 11,
      },
    ];
    await loaded(ctx);
    expect(screen.getByTestId("models-row-gemma-4-12b-it-gguf")).toHaveAttribute(
      "data-downloaded",
      "true",
    );
    expect(
      screen.getByTestId("models-row-gemma-4-12b-it-gguf"),
    ).toHaveAttribute("data-downloaded", "true");
    expect(
      screen.queryByTestId("models-install-gemma-4-12b-it-gguf"),
    ).not.toBeInTheDocument();
  });

  it("switches to Agentic and Video without using type dropdowns", async () => {
    await loaded(client());
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(
      screen.getByTestId("models-row-qwen2.5-coder:7b"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("models-row-gemma4:e4b"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("models-tab-video"));
    expect(screen.getByTestId("models-row-ltx-video")).toBeInTheDocument();
  });

  it("search by name still narrows the active tab", async () => {
    await loaded(client());
    fireEvent.change(screen.getByTestId("models-search"), {
      target: { value: "no-such-model" },
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId("models-row-gemma4:e4b"),
      ).not.toBeInTheDocument();
    });
  });

  it("download shows progress, completes, and marks the row Downloaded", async () => {
    const ctx = client();
    await loaded(ctx);
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(
      screen.getByTestId("models-install-qwen2.5-coder:7b").textContent,
    ).toMatch(/Download/i);
    fireEvent.click(screen.getByTestId("models-install-qwen2.5-coder:7b"));
    expect(ctx.events.install).toEqual(["qwen2.5-coder:7b"]);
    await waitFor(() => {
      expect(
        screen.getByTestId("models-progress-qwen2.5-coder:7b"),
      ).toBeInTheDocument();
    });
    await act(async () => {
      ctx.resolveInstall("qwen2.5-coder:7b");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("models-row-qwen2.5-coder:7b")).toHaveAttribute(
        "data-downloaded",
        "true",
      );
    });
    // v2.4.8 Phase 7: delete replaces the download button in the title row.
    expect(screen.getByTestId("models-remove-qwen2.5-coder:7b")).toBeInTheDocument();
    expect(screen.queryByTestId("models-install-qwen2.5-coder:7b")).toBeNull();
  });

  it("surfaces a row error when download fails instead of flipping to Downloaded", async () => {
    const ctx = client();
    await loaded(ctx);
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    fireEvent.click(screen.getByTestId("models-install-qwen2.5-coder:7b"));
    await act(async () => {
      ctx.rejectInstall("qwen2.5-coder:7b", "disk full");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("models-row-error-qwen2.5-coder:7b").textContent,
      ).toMatch(/disk full/i);
    });
    expect(screen.getByTestId("models-row-qwen2.5-coder:7b")).toHaveAttribute(
      "data-downloaded",
      "false",
    );
    expect(screen.queryByTestId("models-remove-qwen2.5-coder:7b")).toBeNull();
  });

  it("cancel during download removes the progress bar", async () => {
    const ctx = client();
    await loaded(ctx);
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    fireEvent.click(screen.getByTestId("models-install-qwen2.5-coder:7b"));
    const cancel = await screen.findByTestId("models-cancel-qwen2.5-coder:7b");
    await act(async () => {
      fireEvent.click(cancel);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId("models-progress-qwen2.5-coder:7b"),
      ).not.toBeInTheDocument();
    });
  });

  it("remove drops a Downloaded row", async () => {
    const ctx = client();
    await loaded(ctx);
    fireEvent.click(screen.getByTestId("models-remove-gemma4:e4b"));
    await waitFor(() => {
      expect(ctx.events.remove).toEqual(["gemma4:e4b"]);
      expect(
        screen.getByTestId("models-install-gemma4:e4b"),
      ).toBeInTheDocument();
    });
  });

  it("reveal action fires for Other-tab external entries", async () => {
    const ctx = client();
    await loaded(ctx);
    fireEvent.click(screen.getByTestId("models-tab-other"));
    fireEvent.click(
      screen.getByTestId(
        "models-reveal-external:comfyui:checkpoints:dreamshaper",
      ),
    );
    expect(ctx.events.reveal).toEqual(["/abs/dreamshaper.safetensors"]);
  });

  it("renders the disk-usage summary", async () => {
    await loaded(client());
    await waitFor(() => {
      // v2.4.8 follow-up: compact copy ("182 GB used" / "206 GB free") so
      // the summary shares the tab row; the full sentence is the bar's value.
      expect(screen.getByTestId("models-disk-summary").textContent).toMatch(
        /used/,
      );
      expect(screen.getByTestId("models-disk-summary").textContent).toMatch(
        /free/,
      );
      expect(screen.getByTestId("models-disk-summary").textContent).not.toMatch(
        /used by models/,
      );
      expect(
        screen.getByRole("progressbar", { name: "Model storage usage" }),
      ).toBeInTheDocument();
    });
  });

  it("places embed models on the Embeddings tab, not Chat", async () => {
    const embedClient: ModelsClient = {
      async list() {
        return [
          {
            id: "nomic-embed-text",
            displayName: "Nomic Embed Text",
            family: "nomic",
            type: "embed",
            task: "embed",
            installed: true,
            source: "registry",
            license: "Apache-2.0",
          },
        ];
      },
      install() {
        return Object.assign({ cancel() {} }, { done: Promise.resolve() });
      },
      async remove() {},
      async diskUsage() {
        return diskUsage();
      },
    };
    render(<ModelsSettings client={embedClient} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    // Chat is the default tab; the embed row must not park there.
    expect(
      screen.queryByTestId("models-row-nomic-embed-text"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("models-tab-embeddings"));
    expect(
      screen.getByTestId("models-row-nomic-embed-text"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("models-row-nomic-embed-text")).toHaveAttribute(
      "data-downloaded",
      "true",
    );
  });

  it("places audio models on the Audio tab", async () => {
    const audioClient: ModelsClient = {
      async list() {
        return [
          {
            id: "faster-whisper",
            displayName: "faster-whisper (STT)",
            family: "whisper",
            type: "audio",
            task: "audio",
            installed: false,
            source: "catalog-only",
            license: "MIT",
          },
        ];
      },
      install() {
        return Object.assign({ cancel() {} }, { done: Promise.resolve() });
      },
      async remove() {},
      async diskUsage() {
        return diskUsage();
      },
    };
    render(<ModelsSettings client={audioClient} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("models-tab-audio"));
    // v2.4.8 Phase 4: the installer card carries no type icon, so neither does
    // this one. The row and its OpenAI provider color are the evidence.
    expect(screen.queryByTestId("models-icon-audio")).toBeNull();
    expect(screen.getByTestId("models-row-faster-whisper")).toBeInTheDocument();
  });

  it("disables Download on over-budget entries", async () => {
    await loaded(client(), { hostVramGB: 8 });
    fireEvent.click(screen.getByTestId("models-tab-video"));
    // v2.4.8 Phase 7: an incompatible card offers no action at all and is
    // disabled and translucent under the Incompatible heading.
    expect(screen.queryByTestId("models-install-ltx-video")).toBeNull();
    expect(screen.queryByTestId("models-over-budget-ltx-video")).toBeNull();
    expect(screen.getByTestId("models-row-ltx-video")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByTestId("models-row-ltx-video").style.opacity).toBe("0.45");
    expect(screen.getByTestId("models-row-ltx-video").style.pointerEvents).toBe("none");
    expect(screen.getByTestId("models-group-2").textContent).toMatch(/^Incompatible/);
    expect(screen.getByTestId("models-row-ltx-video")).toHaveAttribute(
      "data-over-budget",
      "true",
    );
    expect(
      screen.queryByTestId("models-install-ltx-video"),
    ).not.toBeInTheDocument();
  });

  it("shows every catalog sibling and keeps incompatible rows visible", async () => {
    const ctx = client();
    ctx.state.items = [
      {
        id: "gemma-e2b",
        displayName: "Gemma E2B",
        family: "gemma",
        type: "llm",
        task: "chat",
        installed: false,
        source: "catalog-only",
        vramGB: 4,
      },
      {
        id: "gemma-e4b",
        displayName: "Gemma E4B",
        family: "gemma",
        type: "llm",
        task: "chat",
        installed: false,
        source: "catalog-only",
        vramGB: 6,
        tags: ["recommended"],
      },
      {
        id: "kimi-hidden",
        displayName: "Kimi Large",
        family: "kimi",
        type: "llm",
        task: "chat",
        installed: false,
        source: "catalog-only",
        vramGB: 24,
        hideBelowVramGB: 20,
      },
    ];
    await loaded(ctx, { hostVramGB: 16 });
    expect(screen.getByTestId("models-row-gemma-e4b")).toBeInTheDocument();
    expect(screen.getByTestId("models-row-gemma-e2b")).toBeInTheDocument();
    expect(screen.getByTestId("models-row-kimi-hidden")).toBeInTheDocument();
    expect(screen.getByTestId("models-row-kimi-hidden")).toHaveAttribute(
      "data-over-budget",
      "true",
    );
  });

  it("lists dependency-only family components inside Details without a primary card", async () => {
    const ctx = client();
    ctx.state.items = [
      {
        id: "sana-1.6b-2k",
        displayName: "SANA 1.6B 2K",
        family: "sana",
        type: "image",
        task: "image",
        installed: false,
        source: "catalog-only",
        description: "A compact SANA image model.",
        sizeBytes: 3_200_000_000,
        vramGB: 12,
      },
      {
        id: "dc-ae-f32c32-sana-1.1",
        displayName: "DC-AE f32c32 (SANA 1.1)",
        family: "sana",
        type: "vae",
        installed: false,
        source: "catalog-only",
        sizeBytes: 320_000_000,
      },
    ];
    await loaded(ctx, { hostVramGB: 16 });
    fireEvent.click(screen.getByTestId("models-tab-image"));
    expect(screen.getByTestId("models-row-sana-1.6b-2k")).toBeInTheDocument();
    expect(
      screen.queryByTestId("models-row-dc-ae-f32c32-sana-1.1"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("models-row-sana-1.6b-2k-details")).toBeNull();
    expect(
      screen.getByTestId("models-row-sana-1.6b-2k-components"),
    ).toHaveTextContent("DC-AE f32c32 (SANA 1.1)");
  });

  it("renders installer card copy and the LFM use-restriction note", async () => {
    const lfmClient: ModelsClient = {
      async list() {
        return [
          {
            id: "lfm2.5:2.6b",
            displayName: "LFM2.5 2.6B",
            family: "lfm2.5",
            tag: "2.6b",
            type: "llm",
            task: "agentic",
            installed: false,
            source: "catalog-only",
            sizeBytes: 1_670_000_000,
            vramGB: 3,
            license: "LFM Open License v1.0",
            licenseUrl: "https://www.liquid.ai/lfm-license",
            licenseNote:
              "Free commercial use is limited to entities under USD 10M annual revenue. This is a use restriction, not a download gate.",
            description: "On-device agentic model.",
            strengths: ["Tool calling on CPU"],
            whyRecommended: "The only agentic entry that fits sub-4 GB GPUs.",
          },
        ];
      },
      install() {
        return Object.assign({ cancel() {} }, { done: Promise.resolve() });
      },
      async remove() {},
      async diskUsage() {
        return diskUsage();
      },
    };
    render(<ModelsSettings client={lfmClient} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(
      screen.getByTestId("models-row-lfm2.5:2.6b-description").textContent,
    ).toMatch(/On-device agentic/);
    // v2.4.8 Phase 4 (T016): Best for and Why this one print exactly as the
    // installer card prints them (the v2.4.6 removal is reversed for parity).
    expect(
      screen.getByTestId("models-row-lfm2.5:2.6b-best-for").textContent,
    ).toBe("Best for: Tool calling on CPU");
    // The installer prints Why this one only for recommended picks; this
    // fixture row carries whyRecommended but no recommended tag.
    expect(screen.queryByTestId("models-row-lfm2.5:2.6b-why")).toBeNull();
    expect(screen.getByTestId("models-row-lfm2.5:2.6b")).toHaveAttribute(
      "data-compact",
      "true",
    );
    expect(screen.queryByTestId("models-row-lfm2.5:2.6b-details")).toBeNull();
    const note = screen.getByTestId("models-row-lfm2.5:2.6b-license-note");
    expect(note.textContent).toMatch(/USD 10M/i);
    expect(note.querySelector("a")?.getAttribute("href")).toBe(
      "https://www.liquid.ai/lfm-license",
    );
  });

  it("renders the locked name-row pills, in order, on the header row", async () => {
    const lfmClient: ModelsClient = {
      async list() {
        return [
          {
            id: "lfm2.5:2.6b",
            displayName: "LFM2.5 2.6B",
            family: "lfm2.5",
            type: "llm",
            task: "agentic",
            installed: false,
            source: "catalog-only",
            vramGB: 3,
            contextWindow: 128000,
            origin: "USA",
            agentic: true,
            modalities: ["text"],
            license: "LFM Open License v1.0",
            releaseDate: "2026-08-04",
          },
          {
            id: "split-ctx",
            displayName: "Split Window",
            family: "split",
            type: "llm",
            task: "agentic",
            installed: false,
            source: "catalog-only",
            vramGB: 4,
            contextWindowIn: 32000,
            contextWindowOut: 8000,
          },
        ];
      },
      install() {
        return Object.assign({ cancel() {} }, { done: Promise.resolve() });
      },
      async remove() {},
      async diskUsage() {
        return diskUsage();
      },
    };
    render(<ModelsSettings client={lfmClient} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    // v2.4.8 Phase 4 (T016): the installer name-row grammar. Every fact pill
    // (Company, Country, Agentic, Context window, Multimodal, License,
    // Released) sits on the name row after the display name; there is no
    // separate Requirements row.
    expect(screen.queryByTestId("models-facts-lfm2.5:2.6b")).toBeNull();
    const pillRow = screen.getByTestId("models-pills-lfm2.5:2.6b");
    expect(Array.from(pillRow.children).map((c) => c.textContent)).toEqual([
      "Company: Liquid AI",
      "Country: USA",
      "Agentic: Yes",
      "Context window: 128k tokens",
      "Multimodal: No",
      "License: LFM Open License v1.0",
      "Released: August 2026",
    ]);
    const header = screen.getByTestId("models-header-lfm2.5:2.6b");
    expect(screen.queryByTestId("models-row-lfm2.5:2.6b-details")).toBeNull();
    expect(header.contains(pillRow)).toBe(true);
    expect(header.firstChild?.textContent).toBe("LFM2.5 2.6B");
    // Liquid AI is sky in the shared provider fixture: name and card tint.
    expect((header.firstChild as HTMLElement).style.color).toBe(
      "rgb(56, 189, 248)",
    );
    expect(
      screen.getByTestId("models-row-lfm2.5:2.6b").getAttribute("data-provider-color"),
    ).toBe("#38bdf8");
    // The split-window row derives its pill from the in-window.
    expect(screen.getByTestId("models-pills-split-ctx").textContent).toContain(
      "Context window: 32k tokens",
    );
  });

  it("does not invent a 128k pill for gemma without a catalog window or a null diffusion row", async () => {
    await loaded(client());
    expect(
      screen.getByTestId("models-pills-gemma4:e4b").textContent,
    ).not.toMatch(/Context window/);
    fireEvent.click(screen.getByTestId("models-tab-video"));
    expect(
      screen.getByTestId("models-pills-ltx-video").textContent,
    ).not.toMatch(/Context window/);
    expect(screen.getByTestId("models-row-ltx-video")).toBeInTheDocument();
  });

  // v2.4.8 Phase 7 (T034): operator feedback 2026-09-07. No star, no
  // checkmark, no action row under the body; the title row carries the size
  // pill and the one action that applies.
  it("puts size then delete in the title row and renders no star or action row", async () => {
    await loaded(client());
    expect(screen.queryByTestId("models-favorite-gemma4:e4b")).toBeNull();
    expect(screen.queryByTestId("models-actions-gemma4:e4b")).toBeNull();
    expect(screen.queryByTestId("models-downloaded-gemma4:e4b")).toBeNull();
    expect(screen.queryByTestId("models-compat-badge-gemma4:e4b")).toBeNull();
    expect(screen.queryByTestId("models-downloaded-badge-gemma4:e4b")).toBeNull();
    const cluster = screen.getByTestId("models-badges-gemma4:e4b");
    const children = Array.from(cluster.children);
    expect(children[0]).toBe(screen.getByTestId("models-size-gemma4:e4b"));
    expect(cluster.contains(screen.getByTestId("models-remove-gemma4:e4b"))).toBe(true);
    expect(
      screen.getByTestId("models-title-row-gemma4:e4b").contains(cluster),
    ).toBe(true);
    // A compatible, not-yet-downloaded row gets the download button instead.
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    const agenticCluster = screen.getByTestId("models-badges-qwen2.5-coder:7b");
    expect(
      agenticCluster.contains(screen.getByTestId("models-install-qwen2.5-coder:7b")),
    ).toBe(true);
    expect(screen.queryByTestId("models-remove-qwen2.5-coder:7b")).toBeNull();
  });

  it("groups every tab as Downloaded, Compatible, Incompatible with collapsible headings", async () => {
    const ctx = client();
    ctx.state.items = [
      ...ctx.state.items,
      {
        id: "big-chat",
        displayName: "Big Chat",
        type: "llm",
        task: "chat",
        installed: false,
        source: "catalog-only",
        vramGB: 40,
      },
      {
        id: "small-chat",
        displayName: "Small Chat",
        type: "llm",
        task: "chat",
        installed: false,
        source: "catalog-only",
        vramGB: 4,
      },
    ];
    await loaded(ctx, { hostVramGB: 16 });
    const headings = screen
      .getAllByTestId(/^models-group-\d$/)
      .map((el) => el.textContent);
    expect(headings).toEqual(["Downloaded1", "Compatible1", "Incompatible1"]);
    // Heading order is the list order: downloaded rows sit under Downloaded.
    const list = screen.getByTestId("models-list");
    const order = Array.from(list.children).map(
      (el) => el.getAttribute("data-testid") ?? "",
    );
    expect(order.indexOf("models-group-0")).toBeLessThan(order.indexOf("models-row-gemma4:e4b"));
    expect(order.indexOf("models-row-gemma4:e4b")).toBeLessThan(order.indexOf("models-group-1"));
    expect(order.indexOf("models-group-1")).toBeLessThan(order.indexOf("models-row-small-chat"));
    expect(order.indexOf("models-row-small-chat")).toBeLessThan(order.indexOf("models-group-2"));
    expect(order.indexOf("models-group-2")).toBeLessThan(order.indexOf("models-row-big-chat"));
    // Collapse Compatible: its rows disappear, the others stay.
    const toggle = screen.getByTestId("models-group-toggle-1");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("models-group-1")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByTestId("models-row-small-chat")).toBeNull();
    expect(screen.getByTestId("models-row-gemma4:e4b")).toBeInTheDocument();
    expect(screen.getByTestId("models-row-big-chat")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByTestId("models-row-small-chat")).toBeInTheDocument();
    // A tab with a single group still shows its heading.
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(screen.getByTestId("models-group-1").textContent).toBe("Compatible1");
    expect(screen.queryByTestId("models-group-0")).toBeNull();
  });

  it("does not contain a raw select element (installer tabs replace Type/Family/Status)", async () => {
    await loaded(client());
    expect(screen.queryByTestId("models-filter-type")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("models-filter-family"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("models-filter-source"),
    ).not.toBeInTheDocument();
  });

  it("makes the model list a scrolling flex child", async () => {
    await loaded(client());
    const list = screen.getByTestId("models-list");
    expect(list.style.overflowY).toBe("auto");
    expect(list.style.minHeight).toBe("0px");
  });

  it("shows Needs VRAM instead of Compatible for SANA 1.6B 4K on a 16 GB host", async () => {
    const sanaClient: ModelsClient = {
      async list() {
        return [
          {
            id: "sana-1.6b-4k",
            displayName: "SANA 1.6B 4K",
            family: "sana",
            type: "image",
            task: "image",
            installed: false,
            source: "catalog-only",
            vramGB: 20,
            origin: "USA",
            releaseDate: "2025-09-10",
            uncensored: false,
            tags: [],
          },
          {
            id: "sana-sprint-1024",
            displayName: "SANA Sprint 1024",
            family: "sana",
            type: "image",
            task: "image",
            installed: false,
            source: "catalog-only",
            vramGB: 8,
            tags: ["recommended"],
            origin: "USA",
            releaseDate: "2026-05-01",
            uncensored: false,
          },
        ];
      },
      install() {
        return Object.assign({ cancel() {} }, { done: Promise.resolve() });
      },
      async remove() {},
      async diskUsage() {
        return diskUsage();
      },
    };
    render(<ModelsSettings client={sanaClient} hostVramGB={16} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("models-tab-image"));
    const rows = screen.getAllByTestId(
      /^models-row-(sana-sprint-1024|sana-1\.6b-4k)$/,
    );
    expect(rows[0]).toHaveAttribute(
      "data-testid",
      "models-row-sana-sprint-1024",
    );
    expect(rows[1]).toHaveAttribute("data-testid", "models-row-sana-1.6b-4k");
    expect(rows[1]).toHaveAttribute("data-over-budget", "true");
    // v2.4.8 Phase 4 (T016): compatibility is a round badge whose wording is
    // the tooltip, plus a note under the name row when the model does not fit.
    // v2.4.8 Phase 7: no compatibility checkmark; the incompatible row keeps
    // its note, loses its download button, and sits under Incompatible.
    expect(screen.queryByTestId("models-compat-badge-sana-1.6b-4k")).toBeNull();
    expect(
      screen.getByTestId("models-row-sana-1.6b-4k-incompatible").textContent,
    ).toBe("Incompatible - needs 20 GB VRAM");
    expect(screen.queryByTestId("models-install-sana-1.6b-4k")).toBeNull();
    expect(screen.getByTestId("models-install-sana-sprint-1024")).toBeInTheDocument();
    expect(screen.getByTestId("models-group-2").textContent).toBe("Incompatible1");
    expect(
      screen.getByTestId("models-badge-sana-sprint-1024").textContent,
    ).toBe("Recommended");
    expect(
      screen.getByTestId("models-badge-sana-sprint-1024").style.color,
    ).toBe("rgb(70, 130, 180)");
    expect(screen.queryByTestId("models-facts-sana-1.6b-4k")).toBeNull();
    const pills = Array.from(
      screen.getByTestId("models-pills-sana-1.6b-4k").children,
    ).map((c) => c.textContent);
    expect(pills).toEqual([
      "Company: NVIDIA",
      "Country: USA",
      "Guardrails: Censored",
      "Released: September 2025",
    ]);
  });

  it("shows Retry when Qwen 3.5 4B was selected at install but is not on disk", async () => {
    const qwenClient: ModelsClient = {
      async list() {
        return [
          {
            id: "qwen3.5:4b",
            displayName: "Qwen 3.5 4B",
            family: "qwen",
            type: "llm",
            task: "agentic",
            installed: false,
            source: "catalog-only",
            selectedAtInstall: true,
            vramGB: 4,
          },
        ];
      },
      install() {
        return Object.assign({ cancel() {} }, { done: Promise.resolve() });
      },
      async remove() {},
      async diskUsage() {
        return diskUsage();
      },
    };
    render(<ModelsSettings client={qwenClient} hostVramGB={16} />);
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(
      screen.getByTestId("models-row-qwen3.5:4b-selected-missing").textContent,
    ).toMatch(/Selected during setup/);
    expect(screen.getByTestId("models-install-qwen3.5:4b").textContent).toMatch(
      /Retry/i,
    );
  });
});
