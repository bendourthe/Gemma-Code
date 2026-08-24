/**
 * v2.1.0 Phase 6 -- JSON CLI HTTP client (loopback bearer token).
 * Used by unit tests and by bin/nexus.mjs via a thin wrapper.
 */

export const JSON_CLI_PREFIX = "/nexus";

export type JsonCliFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown>; ok: boolean }>;

export interface JsonCliClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetchImpl?: JsonCliFetch;
}

export interface JsonCliResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly body: unknown;
}

function errorBody(code: string, message: string, extra: Record<string, unknown> = {}): JsonCliResult {
  const exitCode = code === "usage" || code === "schema" ? 2 : 1;
  return { ok: false, exitCode, body: { error: { code, message, ...extra } } };
}

export function parseJsonInput(
  raw: string | undefined,
  fallback: Record<string, unknown> = {},
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: fallback };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "JSON input must be an object" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function jsonCliRequest(
  opts: JsonCliClientOptions,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<JsonCliResult> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as JsonCliFetch);
  const url = `${opts.baseUrl.replace(/\/$/, "")}${path}`;
  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${opts.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body && method !== "GET" ? JSON.stringify(body) : undefined,
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (res.status === 401 || res.status === 403) {
      return errorBody("auth", "Bearer token rejected. Check nexus.serving.token.", { status: res.status });
    }
    if (!res.ok) {
      return errorBody("sidecar", `Sidecar returned HTTP ${res.status}`, { status: res.status, body: parsed });
    }
    return { ok: true, exitCode: 0, body: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorBody(
      "sidecar-down",
      `Sidecar is not reachable at ${url}. Start Nexus and enable Local API server (Settings > Local API server). ${message}`,
    );
  }
}

export const SESSION_NEW_SCHEMA = { required: ["modelId"] as const };
export const SESSION_SEND_SCHEMA = { required: ["sessionId", "text"] as const };
export const GENERATE_QUEUE_SCHEMA = { required: ["pillar", "jobType", "parameters"] as const };

export function requireFields(value: Record<string, unknown>, required: readonly string[]): string | null {
  const missing = required.filter((k) => value[k] === undefined || value[k] === null || value[k] === "");
  return missing.length > 0 ? `missing fields: ${missing.join(", ")}` : null;
}

export interface JsonCliDispatchInput {
  readonly command: string;
  readonly subcommand: string | null;
  readonly flags: Record<string, unknown>;
  readonly client: JsonCliClientOptions;
}

/**
 * Map `nexus session|models|generate` to loopback HTTP. Schema failures
 * never touch the network (exit 2).
 */
export async function dispatchJsonCli(input: JsonCliDispatchInput): Promise<JsonCliResult> {
  const { command, subcommand, flags, client } = input;
  const jsonFlag = flags.json;
  const rawJson = typeof jsonFlag === "string" ? jsonFlag : undefined;

  if (command === "session" && subcommand === "new") {
    const parsed = parseJsonInput(rawJson);
    if (!parsed.ok) return errorBody("schema", parsed.error);
    const missing = requireFields(parsed.value, SESSION_NEW_SCHEMA.required);
    if (missing) return errorBody("schema", missing);
    return jsonCliRequest(client, "POST", `${JSON_CLI_PREFIX}/session/new`, parsed.value);
  }
  if (command === "session" && subcommand === "send") {
    const parsed = parseJsonInput(rawJson);
    if (!parsed.ok) return errorBody("schema", parsed.error);
    const missing = requireFields(parsed.value, SESSION_SEND_SCHEMA.required);
    if (missing) return errorBody("schema", missing);
    return jsonCliRequest(client, "POST", `${JSON_CLI_PREFIX}/session/send`, parsed.value);
  }
  if (command === "session" && subcommand === "list") {
    return jsonCliRequest(client, "GET", `${JSON_CLI_PREFIX}/session/list`);
  }
  if (command === "models" && subcommand === "list") {
    return jsonCliRequest(client, "GET", `${JSON_CLI_PREFIX}/models`);
  }
  if (command === "generate" && subcommand === "queue") {
    const parsed = parseJsonInput(rawJson);
    if (!parsed.ok) return errorBody("schema", parsed.error);
    const missing = requireFields(parsed.value, GENERATE_QUEUE_SCHEMA.required);
    if (missing) return errorBody("schema", missing);
    return jsonCliRequest(client, "POST", `${JSON_CLI_PREFIX}/generate/queue`, parsed.value);
  }
  if (command === "generate" && subcommand === "status") {
    const id = typeof flags.id === "string" ? flags.id : "";
    if (!id) return errorBody("schema", "missing fields: id");
    return jsonCliRequest(client, "GET", `${JSON_CLI_PREFIX}/generate/status?id=${encodeURIComponent(id)}`);
  }
  return errorBody("usage", `unknown JSON CLI command "${command} ${subcommand ?? ""}"`);
}
