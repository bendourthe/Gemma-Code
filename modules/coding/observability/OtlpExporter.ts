import type { Span } from "./TraceStore.js";
import type { TracerExporter } from "./Tracer.js";
import { isSsrfBlockedSync } from "../utils/ssrf.js";
import { getLogger } from "../utils/logger.js";
import { formatForLog } from "../utils/errors.js";

// ---------------------------------------------------------------------------
// OTLP JSON schema types (minimal subset)
// ---------------------------------------------------------------------------

interface OtlpKeyValue {
  key: string;
  value: { stringValue?: string; intValue?: number; boolValue?: boolean };
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: { code: number };
  attributes: OtlpKeyValue[];
}

interface OtlpExportRequest {
  resourceSpans: Array<{
    resource: { attributes: OtlpKeyValue[] };
    scopeSpans: Array<{
      scope: { name: string };
      spans: OtlpSpan[];
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OtlpExporterConfig {
  readonly endpoint: string;
  readonly headers?: Record<string, string>;
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// OtlpExporter
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;

/** OTLP/HTTP JSON span kind constants. */
const SPAN_KIND_INTERNAL = 1;
const SPAN_KIND_CLIENT = 3;

/** OTLP status codes. */
const STATUS_CODE_OK = 1;
const STATUS_CODE_ERROR = 2;

export class OtlpExporter implements TracerExporter {
  private readonly _endpoint: string;
  private readonly _headers: Record<string, string>;
  private readonly _batchSize: number;
  private _buffer: Span[] = [];
  private _flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: OtlpExporterConfig) {
    if (isSsrfBlockedSync(config.endpoint)) {
      throw new Error(
        `OtlpExporter endpoint rejected by SSRF check: "${config.endpoint}". ` +
          `Point at a non-loopback, non-private collector URL.`,
      );
    }
    this._endpoint = config.endpoint;
    this._headers = config.headers ?? {};
    this._batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

    if (this._hasAuthorizationHeader()) {
      getLogger().warn(
        "[OtlpExporter] Authorization header configured. Credentials will be sent to the OTLP endpoint; " +
          "verify the endpoint is a trusted collector before enabling.",
      );
    }

    const intervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this._flushTimer = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  private _hasAuthorizationHeader(): boolean {
    for (const key of Object.keys(this._headers)) {
      if (key.toLowerCase() === "authorization") return true;
    }
    return false;
  }

  enqueueSpan(span: Span): void {
    this._buffer.push(span);
    if (this._buffer.length >= this._batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this._buffer.length === 0) return;

    const batch = this._buffer.splice(0);
    const body = this._buildOtlpPayload(batch);

    try {
      const response = await fetch(this._endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this._headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        getLogger().debug(
          `[OtlpExporter] Export failed: ${response.status} ${response.statusText}`,
        );
      }
    } catch (err) {
      // Network errors (including timeouts) are non-fatal; log and discard.
      getLogger().debug(
        `[OtlpExporter] Export error: ${formatForLog(err)}`,
      );
    }
  }

  dispose(): void {
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    // Synchronous flush of remaining spans -- fire and forget.
    void this.flush();
  }

  /** Number of spans currently buffered (for testing). */
  get bufferSize(): number {
    return this._buffer.length;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _buildOtlpPayload(spans: readonly Span[]): OtlpExportRequest {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: "gemma-code" },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "gemma-code" },
              spans: spans.map((s) => this._spanToOtlp(s)),
            },
          ],
        },
      ],
    };
  }

  private _spanToOtlp(span: Span): OtlpSpan {
    const otlp: OtlpSpan = {
      traceId: span.traceId.replace(/-/g, ""),
      spanId: span.spanId.replace(/-/g, "").slice(0, 16),
      name: span.name,
      kind: span.kind === "llm_call" ? SPAN_KIND_CLIENT : SPAN_KIND_INTERNAL,
      startTimeUnixNano: String(span.startTime * 1_000_000),
      endTimeUnixNano: String((span.endTime ?? span.startTime) * 1_000_000),
      status: {
        code: span.status === "error" ? STATUS_CODE_ERROR : STATUS_CODE_OK,
      },
      attributes: this._attrsToOtlp(span.attributes),
    };

    if (span.parentSpanId) {
      otlp.parentSpanId = span.parentSpanId.replace(/-/g, "").slice(0, 16);
    }

    return otlp;
  }

  private _attrsToOtlp(
    attrs: Record<string, string | number | boolean>,
  ): OtlpKeyValue[] {
    return Object.entries(attrs).map(([key, val]) => {
      if (typeof val === "string") {
        return { key, value: { stringValue: val } };
      }
      if (typeof val === "number") {
        return { key, value: { intValue: val } };
      }
      return { key, value: { boolValue: val } };
    });
  }
}

// ---------------------------------------------------------------------------
// Utility: parse header string from settings
// ---------------------------------------------------------------------------

export function parseOtlpHeaders(
  headerString: string,
): Record<string, string> {
  if (!headerString) return {};
  return Object.fromEntries(
    headerString
      .split(",")
      .map((pair): [string, string] | null => {
        const eqIdx = pair.indexOf("=");
        if (eqIdx <= 0) return null;
        const key = pair.slice(0, eqIdx).trim();
        if (!key) return null;
        return [key, pair.slice(eqIdx + 1).trim()];
      })
      .filter((entry): entry is [string, string] => entry !== null),
  );
}
