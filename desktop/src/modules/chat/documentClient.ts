/**
 * v1.16.0 Phase 3 (adoption item A5) -- renderer client for document parsing.
 *
 * Wraps the sidecar's `ocr.*` IPC (accept -> poll -> cancel) plus the
 * installed-model check the chat surface needs to decide between "parse this"
 * and "you have no document model installed". Keeping both behind one interface
 * means `ChatPage` takes a single injectable dependency, and tests drive the
 * whole parse flow with `InMemoryDocumentClient` -- no sidecar, no Python.
 */

import { ipcCall } from "../../lib/ipc";
import type { ListedModelDto } from "../../pages/settings/modelsTypes";
import type {
  OcrJobDrainResponseT,
  OcrJobEventEnvelopeT,
  OcrParseResultT,
} from "../../../sidecar/src/protocol";

/** Poll cadence while a parse runs. A page takes seconds, so this is coarse. */
export const DOCUMENT_POLL_MS = 300;

export interface DocumentParseProgress {
  readonly page: number;
  readonly totalPages: number;
}

export interface DocumentParseHandle {
  readonly jobId: string;
  cancel(): void;
  readonly done: Promise<OcrParseResultT>;
}

export interface DocumentClient {
  /** Installed models of type `document`; empty means nothing to parse with. */
  installedDocumentModels(): Promise<readonly ListedModelDto[]>;
  parse(
    documentBase64: string,
    onProgress: (p: DocumentParseProgress) => void,
    engine?: string,
  ): DocumentParseHandle;
}

interface PollDeps {
  readonly pollMs?: number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

export function createIpcDocumentClient(deps: PollDeps = {}): DocumentClient {
  const pollMs = deps.pollMs ?? DOCUMENT_POLL_MS;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;

  return {
    async installedDocumentModels(): Promise<readonly ListedModelDto[]> {
      const reply = await ipcCall<{ models: ListedModelDto[] }>("models.list", {});
      if (!reply.ok) return [];
      return reply.value.models.filter(
        (m) => m.type === "document" && m.installed && m.source !== "catalog-only",
      );
    },

    parse(documentBase64, onProgress, engine): DocumentParseHandle {
      let cancelled = false;
      let jobId = "";
      let timer: ReturnType<typeof setInterval> | null = null;

      const stop = (): void => {
        if (timer !== null) {
          clearIntervalFn(timer);
          timer = null;
        }
      };

      const done = new Promise<OcrParseResultT>((resolve, reject) => {
        void (async () => {
          const started = await ipcCall<{ jobId: string }>("ocr.parseDocument", {
            documentBase64,
            ...(engine ? { engine } : {}),
          });
          if (!started.ok) {
            reject(new Error(started.message));
            return;
          }
          jobId = started.value.jobId;
          if (cancelled) {
            void ipcCall("ocr.job.cancel", { jobId });
            reject(new Error("cancelled"));
            return;
          }
          timer = setIntervalFn(() => {
            void (async () => {
              if (!jobId) return;
              const drained = await ipcCall<OcrJobDrainResponseT>("ocr.job.drainEvents", {
                jobId,
              });
              if (!drained.ok) {
                stop();
                reject(new Error(drained.message));
                return;
              }
              for (const ev of drained.value.events as OcrJobEventEnvelopeT[]) {
                if (ev.kind === "progress" && typeof ev.page === "number") {
                  onProgress({ page: ev.page, totalPages: ev.totalPages ?? 0 });
                } else if (ev.kind === "error") {
                  stop();
                  reject(new Error(ev.message ?? "document parse failed"));
                  return;
                }
              }
              if (drained.value.done) {
                stop();
                if (drained.value.result) resolve(drained.value.result);
                else reject(new Error("document parse produced no result"));
              }
            })();
          }, pollMs);
        })().catch((err: unknown) => {
          stop();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });

      return {
        get jobId() {
          return jobId;
        },
        cancel() {
          cancelled = true;
          stop();
          if (jobId) void ipcCall("ocr.job.cancel", { jobId });
        },
        done,
      };
    },
  };
}

export interface InMemoryDocumentClientOptions {
  readonly models?: readonly ListedModelDto[];
  readonly result?: OcrParseResultT;
  readonly error?: string;
  readonly progress?: readonly DocumentParseProgress[];
}

/** Scripted client for tests and for dev without a Python runtime. */
export function createInMemoryDocumentClient(
  opts: InMemoryDocumentClientOptions = {},
): DocumentClient {
  return {
    async installedDocumentModels() {
      return opts.models ?? [];
    },
    parse(_documentBase64, onProgress): DocumentParseHandle {
      let cancelled = false;
      const done = new Promise<OcrParseResultT>((resolve, reject) => {
        queueMicrotask(() => {
          if (cancelled) {
            reject(new Error("cancelled"));
            return;
          }
          for (const p of opts.progress ?? []) onProgress(p);
          if (opts.error) {
            reject(new Error(opts.error));
            return;
          }
          resolve(
            opts.result ?? {
              engine: "stub",
              text: "parsed text",
              markdown: null,
              pageCount: 1,
              pages: [{ index: 0, text: "parsed text" }],
            },
          );
        });
      });
      return {
        jobId: "in-memory-job",
        cancel() {
          cancelled = true;
        },
        done,
      };
    },
  };
}
