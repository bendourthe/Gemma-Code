/**
 * v2.1.0 Phase 3 -- pending generation queue bar (count, cancel, reorder).
 */

import type { GenerationJob } from "../../../../core/generations/GenerationQueue";

export interface GenerationQueueBarProps {
  readonly jobs: readonly GenerationJob[];
  readonly onCancel: (id: string) => void;
  readonly onReorder: (ids: readonly string[]) => void;
}

export function GenerationQueueBar({
  jobs,
  onCancel,
  onReorder,
}: GenerationQueueBarProps): JSX.Element {
  const pending = jobs.filter((j) => j.state === "queued" || j.state === "running");
  return (
    <section data-testid="generation-queue-bar" style={{ fontSize: "0.85rem" }}>
      <header>
        Queue <span data-testid="generation-queue-count">{pending.length}</span> pending
      </header>
      {pending.length === 0 ? (
        <p data-testid="generation-queue-empty" style={{ color: "var(--fg-muted)" }}>
          No queued jobs.
        </p>
      ) : (
        <ol data-testid="generation-queue-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {pending.map((job, index) => {
            const isEnhancement =
              job.jobType === "video_enhancement" || job.enhancement != null;
            return (
            <li
              key={job.id}
              data-job-kind={isEnhancement ? "enhancement" : "generation"}
              data-testid={`generation-queue-item-${job.id}`}
            >
              {isEnhancement ? "Enhance " : ""}
              {job.id} {job.state} {job.priority}
              <button
                type="button"
                aria-label={
                  isEnhancement
                    ? `Cancel enhancement ${job.id}`
                    : `Cancel job ${job.id}`
                }
                data-testid={`generation-queue-cancel-${job.id}`}
                onClick={() => onCancel(job.id)}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid={`generation-queue-up-${job.id}`}
                disabled={index === 0}
                onClick={() => {
                  const ids = pending.map((j) => j.id);
                  const swap = ids[index - 1];
                  if (!swap) return;
                  ids[index - 1] = job.id;
                  ids[index] = swap;
                  onReorder(ids);
                }}
              >
                Up
              </button>
            </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
