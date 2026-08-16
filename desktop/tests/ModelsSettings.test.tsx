import { describe, expect, it } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import { ModelsSettings, type ModelsClient, type InstallHandle } from "../src/pages/settings/ModelsSettings";
import type { InstallProgressDto, ListedModelDto } from "../src/pages/settings/modelsTypes";

function makeItems(): ListedModelDto[] {
  return [
    {
      id: "gemma4:e4b",
      displayName: "Gemma 4 E4B",
      family: "gemma4",
      tag: "e4b",
      type: "llm",
      installed: true,
      source: "registry",
      sizeBytes: 2_700_000_000,
      vramGB: 6,
      license: "Gemma Terms of Use",
    },
    {
      id: "qwen2.5-coder:7b",
      displayName: "Qwen 2.5 Coder 7B",
      family: "qwen",
      tag: "7b",
      type: "llm",
      installed: false,
      source: "catalog-only",
      sizeBytes: 4_400_000_000,
      vramGB: 7,
      license: "Apache-2.0",
    },
    {
      id: "ltx-video",
      displayName: "LTX-Video",
      family: "ltx",
      tag: "0.9",
      type: "video",
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
} {
  const events = { install: [] as string[], remove: [] as string[], reveal: [] as string[], progress: [] as InstallProgressDto[] };
  const state = { items: makeItems() };
  const pendingResolvers = new Map<string, (v: void | PromiseLike<void>) => void>();
  const c: ModelsClient = {
    async list() {
      return state.items;
    },
    install(id, onProgress) {
      events.install.push(id);
      const done = new Promise<void>((resolve) => {
        pendingResolvers.set(id, resolve);
      });
      const handle: InstallHandle = {
        cancel() {
          pendingResolvers.get(id)?.();
          pendingResolvers.delete(id);
        },
      };
      // Push an initial progress event so the UI shows the bar immediately.
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
    },
  };
}

describe("ModelsSettings", () => {
  it("renders the three sections after loading", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("section-installed")).toBeInTheDocument();
    expect(screen.getByTestId("section-available")).toBeInTheDocument();
    expect(screen.getByTestId("section-external")).toBeInTheDocument();
    expect(screen.getByTestId("section-installed-count").textContent).toBe("(1)");
    expect(screen.getByTestId("section-available-count").textContent).toBe("(2)");
    expect(screen.getByTestId("section-external-count").textContent).toBe("(1)");
  });

  it("filters by type", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.change(screen.getByTestId("models-filter-type"), { target: { value: "video" } });
    await waitFor(() => {
      expect(screen.getByTestId("section-available-count").textContent).toBe("(1)");
      expect(screen.getByTestId("section-installed-count").textContent).toBe("(0)");
    });
  });

  it("filters by family", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.change(screen.getByTestId("models-filter-family"), { target: { value: "qwen" } });
    await waitFor(() => {
      expect(screen.getByTestId("section-available-count").textContent).toBe("(1)");
    });
  });

  it("search by name narrows results", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.change(screen.getByTestId("models-search"), { target: { value: "ltx" } });
    await waitFor(() => {
      expect(screen.getByTestId("section-available-count").textContent).toBe("(1)");
    });
  });

  it("install shows progress, completes, and moves the row to installed", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
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
      expect(screen.getByTestId("section-installed-count").textContent).toBe("(2)");
    });
  });

  it("cancel during install removes the progress bar", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
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

  it("remove drops a row from Installed", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("models-remove-gemma4:e4b"));
    await waitFor(() => {
      expect(ctx.events.remove).toEqual(["gemma4:e4b"]);
      expect(screen.getByTestId("section-installed-count").textContent).toBe("(0)");
    });
  });

  it("reveal action fires for external entries", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("models-reveal-external:comfyui:checkpoints:dreamshaper"));
    expect(ctx.events.reveal).toEqual(["/abs/dreamshaper.safetensors"]);
  });

  it("renders the disk-usage summary", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => {
      expect(screen.getByTestId("models-disk-summary").textContent).toMatch(/Models occupy/);
    });
  });

  it("renders audio models and filters by the Audio type (IAE.P4.B)", async () => {
    const audioClient: ModelsClient = {
      async list() {
        return [
          {
            id: "gemma4:e4b",
            displayName: "Gemma 4 E4B",
            family: "gemma4",
            type: "llm",
            installed: true,
            source: "registry",
          },
          {
            id: "faster-whisper",
            displayName: "faster-whisper (STT)",
            family: "whisper",
            type: "audio",
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
    // The audio model renders with the audio icon under the default "all" filter.
    expect(screen.getByTestId("models-icon-audio")).toBeInTheDocument();
    // Filtering to Audio keeps the audio entry and drops the LLM.
    fireEvent.change(screen.getByTestId("models-filter-type"), { target: { value: "audio" } });
    await waitFor(() => {
      expect(screen.getByTestId("section-available-count").textContent).toBe("(1)");
      expect(screen.getByTestId("section-installed-count").textContent).toBe("(0)");
    });
  });

  it("filters by installed / available / external status", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    fireEvent.change(screen.getByTestId("models-filter-source"), { target: { value: "installed" } });
    expect(screen.getByTestId("section-installed")).toBeInTheDocument();
    expect(screen.queryByTestId("section-available")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-external")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-installed-count").textContent).toBe("(1)");
  });

  it("filters by tier-fit and disables Install on over-budget entries", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} hostVramGB={8} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("models-filter-tier")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("models-filter-tier"), { target: { value: "over-budget" } });
    await waitFor(() => {
      expect(screen.getByTestId("section-available-count").textContent).toBe("(1)");
      expect(screen.getByTestId("section-installed-count").textContent).toBe("(0)");
    });
    expect(screen.getByTestId("models-over-budget-ltx-video")).toBeInTheDocument();
    expect(screen.queryByTestId("models-install-ltx-video")).not.toBeInTheDocument();
  });

  it("hides the tier-fit filter when host VRAM is unknown", async () => {
    const ctx = client();
    render(<ModelsSettings client={ctx.client} />);
    await waitFor(() => expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument());
    expect(screen.queryByTestId("models-filter-tier")).not.toBeInTheDocument();
    expect(screen.getByTestId("models-install-ltx-video")).toBeInTheDocument();
  });
});
