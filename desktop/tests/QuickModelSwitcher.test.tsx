/**
 * v1.16.0 Phase 5 (A4) -- compact model switcher.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { QuickModelSwitcher } from "../src/shared/models/QuickModelSwitcher";
import { GET_MORE_MODELS_ID } from "../src/shared/models/installedFeed";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const MODELS: ListedModelDto[] = [
  {
    id: "gemma4:e4b",
    displayName: "Gemma 4 E4B",
    type: "llm",
    task: "chat",
    installed: true,
    source: "registry",
  },
  {
    id: "qwen2.5-coder:7b",
    displayName: "Qwen 2.5 Coder 7B",
    type: "llm",
    task: "chat",
    installed: true,
    source: "registry",
  },
  {
    id: "catalog-only-llm",
    displayName: "Not Installed",
    type: "llm",
    task: "chat",
    installed: false,
    source: "catalog-only",
  },
  {
    id: "sana",
    displayName: "SANA",
    type: "image",
    task: "image",
    installed: true,
    source: "registry",
  },
];

const OWNED_LLM = new Set(["gemma4:e4b", "qwen2.5-coder:7b"]);

describe("QuickModelSwitcher", () => {
  it("lists only installed-and-ready models for the task type plus Get more models", () => {
    render(
      <QuickModelSwitcher
        models={MODELS}
        taskType="llm"
        ownedIds={OWNED_LLM}
        value="gemma4:e4b"
        onChange={() => undefined}
      />,
    );
    const select = screen.getByTestId(
      "quick-model-switcher",
    ) as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual([
      "gemma4:e4b",
      "qwen2.5-coder:7b",
      GET_MORE_MODELS_ID,
    ]);
  });

  it("orders llm pickers the same way Settings sorts the Chat tab", () => {
    const shuffled: ListedModelDto[] = [
      {
        id: "qwen-compat",
        displayName: "Qwen Compatible",
        type: "llm",
        task: "chat",
        family: "qwen",
        installed: true,
        source: "registry",
        vramGB: 8,
      },
      {
        id: "gemma-e4b",
        displayName: "Gemma E4B",
        type: "llm",
        task: "chat",
        family: "gemma",
        installed: true,
        source: "registry",
        vramGB: 6,
        tags: ["recommended"],
      },
      {
        id: "sana",
        displayName: "SANA",
        type: "image",
        task: "image",
        installed: true,
        source: "registry",
        vramGB: 8,
      },
    ];
    render(
      <QuickModelSwitcher
        models={shuffled}
        taskType="llm"
        value="qwen-compat"
        onChange={() => undefined}
        ownedIds={new Set(["qwen-compat", "gemma-e4b"])}
        hostVramGB={16}
        recommendOrder={["gemma-e4b", "qwen-compat"]}
      />,
    );
    const select = screen.getByTestId(
      "quick-model-switcher",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "gemma-e4b",
      "qwen-compat",
      GET_MORE_MODELS_ID,
    ]);
  });

  it("does not list catalog-only entries or other task types", () => {
    render(
      <QuickModelSwitcher
        models={MODELS}
        taskType="image"
        ownedIds={new Set(["sana"])}
        value="sana"
        onChange={() => undefined}
      />,
    );
    const select = screen.getByTestId(
      "quick-model-switcher",
    ) as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(["sana", GET_MORE_MODELS_ID]);
    expect(values).not.toContain("gemma4:e4b");
    expect(values).not.toContain("catalog-only-llm");
  });

  it("switches the active model", () => {
    const onChange = vi.fn();
    render(
      <QuickModelSwitcher
        models={MODELS}
        taskType="llm"
        ownedIds={OWNED_LLM}
        value="gemma4:e4b"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("quick-model-switcher"), {
      target: { value: "qwen2.5-coder:7b" },
    });
    expect(onChange).toHaveBeenCalledWith("qwen2.5-coder:7b");
  });

  it("routes Get more models to the deep-link callback instead of onChange", () => {
    const onChange = vi.fn();
    const onGetMore = vi.fn();
    render(
      <QuickModelSwitcher
        models={MODELS}
        taskType="llm"
        ownedIds={OWNED_LLM}
        value="gemma4:e4b"
        onChange={onChange}
        onGetMoreModels={onGetMore}
      />,
    );
    fireEvent.change(screen.getByTestId("quick-model-switcher"), {
      target: { value: GET_MORE_MODELS_ID },
    });
    expect(onGetMore).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with the first owned id when value is not in the ready list", () => {
    const onChange = vi.fn();
    render(
      <QuickModelSwitcher
        models={MODELS}
        taskType="llm"
        value="gemma4:e4b"
        onChange={onChange}
        ownedIds={new Set(["qwen2.5-coder:7b"])}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("qwen2.5-coder:7b");
  });

  it("lists 16 GB agentic models with gemma-4-12b-it-gguf before gpt-oss", () => {
    const models: ListedModelDto[] = [
      {
        id: "gpt-oss:20b",
        displayName: "gpt-oss 20B",
        type: "llm",
        task: "agentic",
        installed: true,
        source: "registry",
        tags: ["recommended"],
      },
      {
        id: "lfm2.5:2.6b",
        displayName: "LFM2.5 2.6B",
        type: "llm",
        task: "agentic",
        installed: true,
        source: "registry",
      },
      {
        id: "gemma-4-12b-it-gguf",
        displayName: "Gemma 4 12B",
        type: "llm",
        task: "agentic",
        installed: true,
        source: "registry",
        tags: ["required"],
      },
    ];
    render(
      <QuickModelSwitcher
        models={models}
        taskType="llm"
        catalogTab="agentic"
        ownedIds={
          new Set(["gpt-oss:20b", "lfm2.5:2.6b", "gemma-4-12b-it-gguf"])
        }
        value="gemma-4-12b-it-gguf"
        onChange={() => undefined}
        hostVramGB={16}
        recommendOrder={["gemma-4-12b-it-gguf", "gpt-oss:20b"]}
      />,
    );
    const select = screen.getByTestId(
      "quick-model-switcher",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "gemma-4-12b-it-gguf",
      "gpt-oss:20b",
      "lfm2.5:2.6b",
      GET_MORE_MODELS_ID,
    ]);
  });
});

// v2.4.8 Phase 5 (T020/T022): operator screenshot 5 (2026-09-06). The Agents
// picker listed gpt-oss 20B, Gemma 4 12B, Inkling-Small, LFM2.5 2.6B, two
// Nemotron entries, Qwen 3.5 4B and 9B, with gpt-oss selected, because the
// snapshot named gpt-oss as the agentic pick. The installer picker lists the
// catalog-recommended Gemma 4 12B first; so does this switcher now.
describe("QuickModelSwitcher v2.4.8 installer order", () => {
  const ROSTER: ListedModelDto[] = [
    { id: "gpt-oss:20b", displayName: "gpt-oss 20B", type: "llm", task: "agentic", agentic: true, installed: true, source: "registry", vramGB: 14, releaseDate: "2025-08-05" },
    { id: "gemma-4-12b-it-gguf", displayName: "Gemma 4 12B", type: "llm", task: "chat", agentic: true, installed: true, source: "registry", vramGB: 11, releaseDate: "2026-05-01", tags: ["recommended"] },
    { id: "inkling-small", displayName: "Inkling-Small (patient tier)", type: "llm", task: "chat", agentic: true, installed: true, source: "registry", vramGB: 0, releaseDate: "2026-07-01" },
    { id: "lfm2.5:2.6b", displayName: "LFM2.5 2.6B", type: "llm", task: "agentic", agentic: true, installed: true, source: "registry", vramGB: 3, releaseDate: "2026-08-04" },
    { id: "nemotron-lightning:30b-a3b", displayName: "Nemotron 3.5 Lightning 30B-A3B", type: "llm", task: "chat", agentic: true, installed: true, source: "registry", vramGB: 20, releaseDate: "2026-06-01" },
    { id: "nemotron-lightning:30b-a3b-offload", displayName: "Nemotron 3.5 Lightning 30B-A3B (expert offload)", type: "llm", task: "chat", agentic: true, installed: true, source: "registry", vramGB: 8, releaseDate: "2026-06-01" },
    { id: "qwen3.5:4b", displayName: "Qwen 3.5 4B", type: "llm", task: "chat", agentic: true, installed: true, source: "registry", vramGB: 4, releaseDate: "2026-02-01" },
    { id: "qwen3.5:9b", displayName: "Qwen 3.5 9B", type: "llm", task: "chat", agentic: true, installed: true, source: "registry", vramGB: 8, releaseDate: "2026-02-01" },
  ];
  const OWNED = new Set(ROSTER.map((m) => m.id));
  // The stale on-disk snapshot: agentic pick gpt-oss first, then install order.
  const STALE_ORDER = [
    "gpt-oss:20b",
    "gemma-4-12b-it-gguf",
    "inkling-small",
    "lfm2.5:2.6b",
    "nemotron-lightning:30b-a3b",
    "nemotron-lightning:30b-a3b-offload",
    "qwen3.5:4b",
    "qwen3.5:9b",
  ];

  function values(): string[] {
    const select = screen.getByTestId("quick-model-switcher") as HTMLSelectElement;
    return [...select.options].map((o) => o.value);
  }

  it("lists Gemma 4 12B first on the Agentic tab despite a stale gpt-oss snapshot pick", () => {
    render(
      <QuickModelSwitcher
        models={ROSTER}
        taskType="llm"
        catalogTab="agentic"
        ownedIds={OWNED}
        value="gpt-oss:20b"
        onChange={() => undefined}
        hostVramGB={16}
        recommendOrder={STALE_ORDER}
      />,
    );
    const ids = values();
    expect(ids[0]).toBe("gemma-4-12b-it-gguf");
    // Untagged rows keep the snapshot order; the 20 GB Nemotron is over budget
    // on a 16 GB host and sinks to the bottom, as in the installer picker.
    expect(ids).toEqual([
      "gemma-4-12b-it-gguf",
      "gpt-oss:20b",
      "inkling-small",
      "lfm2.5:2.6b",
      "nemotron-lightning:30b-a3b-offload",
      "qwen3.5:4b",
      "qwen3.5:9b",
      "nemotron-lightning:30b-a3b",
      GET_MORE_MODELS_ID,
    ]);
  });

  it("orders by tier, newest release, then name when no snapshot order exists", () => {
    render(
      <QuickModelSwitcher
        models={ROSTER}
        taskType="llm"
        catalogTab="chat"
        ownedIds={OWNED}
        value="gemma-4-12b-it-gguf"
        onChange={() => undefined}
      />,
    );
    const ids = values();
    expect(ids[0]).toBe("gemma-4-12b-it-gguf");
    expect(ids.indexOf("inkling-small")).toBeLessThan(ids.indexOf("qwen3.5:4b"));
    expect(ids.at(-1)).toBe(GET_MORE_MODELS_ID);
  });
});
