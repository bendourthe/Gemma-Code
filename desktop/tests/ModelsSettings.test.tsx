import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import { ModelsSettings, type ModelsClient, type InstallHandle } from "../src/pages/settings/ModelsSettings";
import { FAVORITE_STORAGE_PREFIX } from "../src/shared/models/selectionPolicy";
import type { InstallProgressDto, ListedModelDto } from "../src/pages/settings/modelsTypes";

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
  events: { install: string[]; remove: string[]; reveal: string[]; progress: InstallProgressDto[] };
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
  const pendingResolvers = new Map<string, (v: void | PromiseLike<void>) => void>();
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
        (target as { source: ListedModelDto["source"] }).source = "catalog-only";
      }
    },
    reveal(p) {
      events.reveal.push(p);
    },
    async diskUsage() {
      return { usedBytes: 2_700_000_000, freeBytes: 500_000_000_000 };
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

async function loaded(ui: ReturnType<typeof client>, props: { hostVramGB?: number | null } = {}) {
  render(<ModelsSettings client={ui.client} hostVramGB={props.hostVramGB} />);
  await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
}

describe("ModelsSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders installer-parity catalog tabs after loading", async () => {
    await loaded(client());
    for (const id of ["chat", "agentic", "image", "video", "audio", "document"]) {
      expect(screen.getByTestId(`models-tab-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("models-tab-other")).toBeInTheDocument();
    expect(screen.getByTestId("models-panel-chat")).toBeInTheDocument();
    expect(screen.getByTestId("models-row-gemma4:e4b")).toBeInTheDocument();
    expect(screen.queryByTestId("models-row-qwen2.5-coder:7b")).not.toBeInTheDocument();
  });

  it("switches to Agentic and Video without using type dropdowns", async () => {
    await loaded(client());
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(screen.getByTestId("models-row-qwen2.5-coder:7b")).toBeInTheDocument();
    expect(screen.queryByTestId("models-row-gemma4:e4b")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("models-tab-video"));
    expect(screen.getByTestId("models-row-ltx-video")).toBeInTheDocument();
  });

  it("search by name still narrows the active tab", async () => {
    await loaded(client());
    fireEvent.change(screen.getByTestId("models-search"), { target: { value: "no-such-model" } });
    await waitFor(() => {
      expect(screen.queryByTestId("models-row-gemma4:e4b")).not.toBeInTheDocument();
    });
  });

  it("download shows progress, completes, and marks the row Downloaded", async () => {
    const ctx = client();
    await loaded(ctx);
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(screen.getByTestId("models-install-qwen2.5-coder:7b").textContent).toMatch(/Download/i);
    fireEvent.click(screen.getByTestId("models-install-qwen2.5-coder:7b"));
    expect(ctx.events.install).toEqual(["qwen2.5-coder:7b"]);
    await waitFor(() => {
      expect(screen.getByTestId("models-progress-qwen2.5-coder:7b")).toBeInTheDocument();
    });
    await act(async () => {
      ctx.resolveInstall("qwen2.5-coder:7b");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("models-downloaded-qwen2.5-coder:7b")).toBeInTheDocument();
    });
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
      expect(screen.getByTestId("models-row-error-qwen2.5-coder:7b").textContent).toMatch(/disk full/i);
    });
    expect(screen.queryByTestId("models-downloaded-qwen2.5-coder:7b")).not.toBeInTheDocument();
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
      expect(screen.queryByTestId("models-progress-qwen2.5-coder:7b")).not.toBeInTheDocument();
    });
  });

  it("remove drops a Downloaded row", async () => {
    const ctx = client();
    await loaded(ctx);
    fireEvent.click(screen.getByTestId("models-remove-gemma4:e4b"));
    await waitFor(() => {
      expect(ctx.events.remove).toEqual(["gemma4:e4b"]);
      expect(screen.getByTestId("models-install-gemma4:e4b")).toBeInTheDocument();
    });
  });

  it("reveal action fires for Other-tab external entries", async () => {
    const ctx = client();
    await loaded(ctx);
    fireEvent.click(screen.getByTestId("models-tab-other"));
    fireEvent.click(screen.getByTestId("models-reveal-external:comfyui:checkpoints:dreamshaper"));
    expect(ctx.events.reveal).toEqual(["/abs/dreamshaper.safetensors"]);
  });

  it("renders the disk-usage summary", async () => {
    await loaded(client());
    await waitFor(() => {
      expect(screen.getByTestId("models-disk-summary").textContent).toMatch(/Models occupy/);
    });
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
        return { usedBytes: 0, freeBytes: null };
      },
    };
    render(<ModelsSettings client={audioClient} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("models-tab-audio"));
    expect(screen.getByTestId("models-icon-audio")).toBeInTheDocument();
    expect(screen.getByTestId("models-row-faster-whisper")).toBeInTheDocument();
  });

  it("disables Download on over-budget entries", async () => {
    await loaded(client(), { hostVramGB: 8 });
    fireEvent.click(screen.getByTestId("models-tab-video"));
    expect(screen.getByTestId("models-over-budget-ltx-video")).toBeInTheDocument();
    expect(screen.queryByTestId("models-install-ltx-video")).not.toBeInTheDocument();
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
        return { usedBytes: 0, freeBytes: null };
      },
    };
    render(<ModelsSettings client={lfmClient} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(screen.getByTestId("models-row-lfm2.5:2.6b-description").textContent).toMatch(/On-device agentic/);
    expect(screen.getByTestId("models-row-lfm2.5:2.6b-best-for").textContent).toMatch(/Tool calling on CPU/);
    expect(screen.getByTestId("models-row-lfm2.5:2.6b-why").textContent).toMatch(/sub-4 GB/);
    const note = screen.getByTestId("models-row-lfm2.5:2.6b-license-note");
    expect(note.textContent).toMatch(/USD 10M/i);
    expect(note.querySelector("a")?.getAttribute("href")).toBe("https://www.liquid.ai/lfm-license");
  });

  it("favorite is one-per-tab and writes the Phase 2 storage key", async () => {
    await loaded(client());
    fireEvent.click(screen.getByTestId("models-favorite-gemma4:e4b"));
    expect(screen.getByTestId("models-favorite-gemma4:e4b")).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(`${FAVORITE_STORAGE_PREFIX}chat`)).toBe("gemma4:e4b");
  });

  it("does not contain a raw select element (installer tabs replace Type/Family/Status)", async () => {
    await loaded(client());
    expect(screen.queryByTestId("models-filter-type")).not.toBeInTheDocument();
    expect(screen.queryByTestId("models-filter-family")).not.toBeInTheDocument();
    expect(screen.queryByTestId("models-filter-source")).not.toBeInTheDocument();
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
        return { usedBytes: 0, freeBytes: null };
      },
    };
    render(<ModelsSettings client={sanaClient} hostVramGB={16} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("models-tab-image"));
    const rows = screen.getAllByTestId(/models-row-/);
    expect(rows[0]).toHaveAttribute("data-testid", "models-row-sana-sprint-1024");
    expect(rows[1]).toHaveAttribute("data-testid", "models-row-sana-1.6b-4k");
    expect(screen.getByTestId("models-badge-sana-1.6b-4k").textContent).toBe("Needs 20 GB VRAM");
    expect(screen.getByTestId("models-badge-sana-sprint-1024").textContent).toBe("Recommended");
    expect(screen.getByTestId("models-chip-origin-sana-1.6b-4k").textContent).toMatch(/USA/);
    expect(screen.getByTestId("models-chip-date-sana-1.6b-4k").textContent).toMatch(/2025-09-10/);
    expect(screen.getByTestId("models-chip-guardrails-sana-1.6b-4k").textContent).toBe("Censored");
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
        return { usedBytes: 0, freeBytes: null };
      },
    };
    render(<ModelsSettings client={qwenClient} hostVramGB={16} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("models-tab-agentic"));
    expect(screen.getByTestId("models-row-qwen3.5:4b-selected-missing").textContent).toMatch(
      /Selected during setup/,
    );
    expect(screen.getByTestId("models-install-qwen3.5:4b").textContent).toMatch(/Retry/i);
  });
});
