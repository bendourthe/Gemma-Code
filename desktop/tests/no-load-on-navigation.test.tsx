/**
 * v2.2.0 Phase 4 (4.1) -- the navigation invariant.
 *
 * The user's stated worry: clicking Image Studio while an agentic task is
 * running must not evict that task's model. So mounting a route may LIST
 * models, but must never classify a switch or load one. This is the test that
 * would fail if someone later "helpfully" preloads the selected model on mount.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ImageStudioPage } from "../src/modules/image/ImageStudioPage";
import { VideoLabPage } from "../src/modules/video/VideoLabPage";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const IMAGE_MODELS: ListedModelDto[] = [
  {
    id: "sana-1.6b-2k",
    displayName: "SANA 1.6B",
    type: "image",
    installed: true,
    source: "registry",
  } as ListedModelDto,
];

const VIDEO_MODELS: ListedModelDto[] = [
  {
    id: "ltx-video",
    displayName: "LTX Video",
    type: "video",
    installed: true,
    source: "registry",
  } as ListedModelDto,
];

describe("route mounts never load a model", () => {
  it("Image Studio lists models on mount without generating or switching", async () => {
    const list = vi.fn(async () => IMAGE_MODELS);
    const txt2img = vi.fn();
    render(
      <ImageStudioPage
        modelsClient={{ list }}
        client={{ txt2img } as never}
        queueClient={{ list: async () => [], pendingCount: async () => 0 } as never}
      />,
    );
    await waitFor(() => expect(list).toHaveBeenCalled());
    // Listing is fine. Loading is not.
    expect(txt2img).not.toHaveBeenCalled();
    // And no switch dialog appears merely from arriving on the page.
    expect(screen.queryByTestId("model-switch-dialog")).toBeNull();
    expect(screen.queryByTestId("model-switch-chip")).toBeNull();
  });

  it("Video Lab lists models on mount without generating", async () => {
    const list = vi.fn(async () => VIDEO_MODELS);
    render(<VideoLabPage modelsClient={{ list }} />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByTestId("model-switch-dialog")).toBeNull();
  });
});

describe("static audit: no policy call outside a submit path", () => {
  // A structural guard: the policy hook may only be *called* from a submit
  // handler. Catching this by reading the source is crude but it is the only
  // check that survives a future refactor that adds a useEffect preload.
  const files = [
    "src/modules/image/ImageStudioPage.tsx",
    "src/modules/video/VideoLabPage.tsx",
  ];

  it.each(files)("%s does not request a switch from a useEffect", (rel) => {
    const source = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
    // Find every useEffect body and assert none of them classify a switch.
    const effects = source.split("useEffect(").slice(1);
    for (const body of effects) {
      const upToClose = body.slice(0, body.indexOf("}, ["));
      expect(upToClose).not.toContain("residency.request(");
    }
  });

  it("ImageStudioPage classifies only inside its submit handler", () => {
    const source = readFileSync(
      path.resolve(__dirname, "..", "src/modules/image/ImageStudioPage.tsx"),
      "utf8",
    );
    const calls = source.split("residency.request(").length - 1;
    expect(calls).toBe(1);
    // ...and that single call sits after the submit guard.
    const submitIndex = source.indexOf("const handleSubmit");
    const callIndex = source.indexOf("residency.request(");
    expect(callIndex).toBeGreaterThan(submitIndex);
  });
});
