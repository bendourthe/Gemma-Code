/**
 * v2.4.6 Phase 7 -- installer-or-Settings owned pickers on all four tabs.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import { CodingPage } from "../src/modules/coding/CodingPage";
import { ImageStudioPage } from "../src/modules/image/ImageStudioPage";
import { InMemoryDiffusionClient } from "../src/modules/image/diffusionClient";
import { VideoLabPage } from "../src/modules/video/VideoLabPage";
import { InMemoryVideoClient } from "../src/modules/video/videoClient";
import { ModelsSettings } from "../src/pages/settings/ModelsSettings";
import { GET_MORE_MODELS_ID } from "../src/shared/models/installedFeed";
import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";
import type { SelectionSnapshot } from "../src/shared/models/selectionPolicy";

const LEFTOVER_LLM = "leftover-coder:7b";
const LEFTOVER_IMAGE = "juggernaut-xl-v9";
const UNOWNED_CATALOG = "unowned-catalog-chat";

const SNAPSHOT: SelectionSnapshot = {
  schemaVersion: 1,
  orderedIds: [
    "gpt-oss:20b",
    "lfm2.5:1.2b",
    "gemma-4-12b-it-gguf",
    "realvisxl-v5",
    "wan2.1-t2v-1.3b",
  ],
  recommendedByTask: {
    chat: "gemma-4-12b-it-gguf",
    agentic: "gemma-4-12b-it-gguf",
    image: "realvisxl-v5",
    video: "wan2.1-t2v-1.3b",
  },
  downloadedSinceInstall: [],
};

const MODELS: ListedModelDto[] = [
  {
    id: "gemma-4-12b-it-gguf",
    displayName: "Gemma 4 12B",
    type: "llm",
    task: "chat",
    agentic: true,
    installed: true,
    source: "registry",
    vramGB: 11,
  },
  {
    id: "lfm2.5:1.2b",
    displayName: "LFM 2.5 1.2B",
    type: "llm",
    task: "chat",
    installed: true,
    source: "registry",
    vramGB: 2,
  },
  {
    id: "gpt-oss:20b",
    displayName: "gpt-oss 20B",
    type: "llm",
    task: "chat",
    agentic: true,
    installed: true,
    source: "registry",
    vramGB: 14,
  },
  {
    id: LEFTOVER_LLM,
    displayName: "Leftover Coder",
    type: "llm",
    task: "chat",
    agentic: true,
    installed: true,
    source: "registry",
    vramGB: 8,
  },
  {
    id: UNOWNED_CATALOG,
    displayName: "Unowned Catalog Chat",
    type: "llm",
    task: "chat",
    installed: false,
    source: "catalog-only",
    vramGB: 6,
  },
  {
    id: "realvisxl-v5",
    displayName: "RealVisXL V5",
    type: "image",
    task: "image",
    installed: true,
    source: "registry",
    vramGB: 6,
  },
  {
    id: LEFTOVER_IMAGE,
    displayName: "Juggernaut XL v9",
    type: "image",
    task: "image",
    installed: true,
    source: "registry",
    vramGB: 8,
  },
  {
    id: "wan2.1-t2v-1.3b",
    displayName: "Wan 2.1 T2V 1.3B",
    type: "video",
    task: "video",
    installed: true,
    source: "registry",
    vramGB: 5.5,
  },
];

function modelsClient() {
  return {
    lastSelection: SNAPSHOT,
    async list() {
      return MODELS;
    },
  };
}

function optionValues(testId: string): string[] {
  return [...(screen.getByTestId(testId) as HTMLSelectElement).options].map(
    (option) => option.value,
  );
}

afterEach(() => {
  cleanup();
  clearInvokeOverride();
});

describe("owned picker allowlist (v2.4.6 Phase 7)", () => {
  it("hides leftover installed ids from Chat, Agents, Image, and Video", async () => {
    render(
      <ChatPage
        client={new InMemoryChatExplorerClient()}
        modelsClient={modelsClient()}
        hostVramGB={16}
      />,
    );
    await waitFor(() => {
      expect(optionValues("chat-model-select")).toContain(
        "gemma-4-12b-it-gguf",
      );
    });
    expect(optionValues("chat-model-select")).toEqual([
      "gemma-4-12b-it-gguf",
      "gpt-oss:20b",
      "lfm2.5:1.2b",
      GET_MORE_MODELS_ID,
    ]);
    expect(optionValues("chat-model-select")).not.toContain(LEFTOVER_LLM);
    cleanup();

    setInvokeOverride(async (cmd, args) => {
      if (cmd === "canonicalize_workspace_roots") return args?.paths ?? [];
      if (cmd === "default_workspace_root") return "C:\\Users\\tester";
      const method = (args as { method?: string } | undefined)?.method;
      if (method === "coding.sessions.list") return { sessions: [] };
      if (method === "coding.memory.snapshot") {
        return {
          snapshot: {
            layers: { core: [], recent: [], working: [], project: [] },
            anticipated: [],
            proposedSkills: [],
          },
        };
      }
      if (method === "coding.trace.subscribe") return { events: [] };
      return {};
    });
    render(<CodingPage modelsClient={modelsClient()} hostVramGB={16} />);
    await waitFor(() => {
      expect(optionValues("coding-model-select")).toContain(
        "gemma-4-12b-it-gguf",
      );
    });
    expect(optionValues("coding-model-select")).toEqual([
      "gemma-4-12b-it-gguf",
      "gpt-oss:20b",
      GET_MORE_MODELS_ID,
    ]);
    expect(optionValues("coding-model-select")).not.toContain(LEFTOVER_LLM);
    cleanup();
    clearInvokeOverride();

    render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={modelsClient()}
        hostVramGB={16}
        drainIntervalMs={20}
      />,
    );
    await waitFor(() => {
      expect(optionValues("image-model-select")).toContain("realvisxl-v5");
    });
    expect(optionValues("image-model-select")).toEqual([
      "realvisxl-v5",
      GET_MORE_MODELS_ID,
    ]);
    expect(optionValues("image-model-select")).not.toContain(LEFTOVER_IMAGE);
    cleanup();

    render(
      <VideoLabPage
        client={new InMemoryVideoClient()}
        modelsClient={modelsClient()}
        vramGB={16}
        drainIntervalMs={20}
      />,
    );
    await waitFor(() => {
      expect(optionValues("video-model-select")).toContain("wan2.1-t2v-1.3b");
    });
    expect(optionValues("video-model-select")).toEqual([
      "wan2.1-t2v-1.3b",
      GET_MORE_MODELS_ID,
    ]);
    expect(optionValues("video-model-select")).not.toContain(LEFTOVER_LLM);
    expect(optionValues("video-model-select")).not.toContain(LEFTOVER_IMAGE);
  });

  it("still lists unowned catalog cards in Settings > Models", async () => {
    render(
      <ModelsSettings
        client={{
          async list() {
            return MODELS;
          },
          install(_id, _onProgress) {
            return Object.assign({ cancel() {} }, { done: Promise.resolve() });
          },
          async remove() {},
          async diskUsage() {
            return {
              usedBytes: 0,
              modelBytes: 0,
              freeBytes: null,
              capacityBytes: null,
              measurementPath: "C:\\Users\\test\\.nexus\\models",
              measuredAt: "2026-08-29T00:00:00.000Z",
            };
          },
        }}
        hostVramGB={16}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("models-loading")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId(`models-row-${UNOWNED_CATALOG}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`models-row-${LEFTOVER_LLM}`),
    ).toBeInTheDocument();
  });
});
