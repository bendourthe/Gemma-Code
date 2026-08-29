import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GenerationJob } from "../../core/generations/GenerationQueue";
import { GenerationQueueBar } from "../src/shared/studio/GenerationQueueBar";

function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "gen-1",
    pillar: "video",
    jobType: "text2video",
    parameters: {},
    batchSpec: null,
    parentId: null,
    enhancement: null,
    sortOrder: 0,
    state: "queued",
    priority: "interactive",
    threadId: null,
    error: null,
    createdAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-08-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("GenerationQueueBar", () => {
  it("labels enhancement children and cancels them by job id", () => {
    const onCancel = vi.fn();
    render(
      <GenerationQueueBar
        jobs={[
          job(),
          job({
            id: "enhance-1",
            jobType: "video_enhancement",
            parentId: "gen-1",
            state: "running",
          }),
        ]}
        onCancel={onCancel}
        onReorder={vi.fn()}
      />,
    );

    expect(screen.getByTestId("generation-queue-item-gen-1")).toHaveAttribute(
      "data-job-kind",
      "generation",
    );
    expect(
      screen.getByTestId("generation-queue-item-enhance-1"),
    ).toHaveAttribute("data-job-kind", "enhancement");
    expect(screen.getByText(/Enhance enhance-1/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel enhancement enhance-1" }),
    );
    expect(onCancel).toHaveBeenCalledWith("enhance-1");
  });
});
