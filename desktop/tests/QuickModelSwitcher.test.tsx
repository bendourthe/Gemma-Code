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

describe("QuickModelSwitcher", () => {
  it("lists only installed-and-ready models for the task type plus Get more models", () => {
    render(
      <QuickModelSwitcher
        models={MODELS}
        taskType="llm"
        value="gemma4:e4b"
        onChange={() => undefined}
      />,
    );
    const select = screen.getByTestId("quick-model-switcher") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(["gemma4:e4b", "qwen2.5-coder:7b", GET_MORE_MODELS_ID]);
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
        hostVramGB={16}
      />,
    );
    const select = screen.getByTestId("quick-model-switcher") as HTMLSelectElement;
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
        value="sana"
        onChange={() => undefined}
      />,
    );
    const select = screen.getByTestId("quick-model-switcher") as HTMLSelectElement;
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
        value="gemma-4-12b-it-gguf"
        onChange={() => undefined}
        hostVramGB={16}
        recommendOrder={["gemma-4-12b-it-gguf", "gpt-oss:20b"]}
      />,
    );
    const select = screen.getByTestId("quick-model-switcher") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "gemma-4-12b-it-gguf",
      "gpt-oss:20b",
      "lfm2.5:2.6b",
      GET_MORE_MODELS_ID,
    ]);
  });
});
