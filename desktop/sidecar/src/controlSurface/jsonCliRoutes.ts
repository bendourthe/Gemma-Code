/**
 * v2.1.0 Phase 6 -- JSON CLI routes on the shared loopback control surface.
 *
 * Sibling of ACP (`POST /acp`) and serving (`/v1/*`). Never mounted under
 * `/v1` because ServingGateway 404s unknown OpenAI paths.
 */

import { JSON_CLI_PREFIX } from "../../../../core/cli/jsonCli.js";
import { CONTROL_SURFACE_JSON_CLI_PREFIX } from "./contract.js";
import {
  parseJsonBody,
  readLimitedBody,
  type ControlSurfaceContext,
  type ControlSurfaceRoute,
} from "./loopbackServer.js";
import type { CodingSessionManager } from "../coding/sessionManager.js";
import { SIDECAR_MODELS } from "../coding/models.js";
import type { StudioRuntime } from "../generations/studioRuntime.js";

export interface JsonCliRouteDeps {
  readonly sessions: CodingSessionManager;
  readonly studio?: StudioRuntime;
  readonly listModels?: () => Promise<readonly { id: string; displayName?: string }[]>;
}

function queryId(path: string): string | null {
  const q = path.split("?")[1];
  if (!q) return null;
  const params = new URLSearchParams(q);
  const id = params.get("id");
  return id && id.length > 0 ? id : null;
}

function pathOnly(path: string): string {
  return path.split("?")[0] ?? path;
}

export function createJsonCliRoute(deps: JsonCliRouteDeps): ControlSurfaceRoute {
  const prefix = CONTROL_SURFACE_JSON_CLI_PREFIX;
  return async (ctx: ControlSurfaceContext): Promise<boolean> => {
    const path = pathOnly(ctx.path);
    if (!path.startsWith(prefix) && !path.startsWith(JSON_CLI_PREFIX)) return false;

    const write = (status: number, body: unknown): boolean => {
      ctx.writer.json(status, body);
      return true;
    };

    try {
      if (ctx.method === "POST" && path === `${prefix}/session/new`) {
        const raw = await readLimitedBody(ctx.req, ctx.maxBodyBytes);
        const body = parseJsonBody(raw) as Record<string, unknown>;
        const modelId = typeof body.modelId === "string" ? body.modelId : "";
        if (!modelId) return write(400, { error: { code: "schema", message: "missing fields: modelId" } });
        const started = deps.sessions.start({
          modelId,
          title: typeof body.title === "string" ? body.title : undefined,
          workspacePath: typeof body.workspacePath === "string" ? body.workspacePath : undefined,
        });
        return write(200, started);
      }

      if (ctx.method === "POST" && path === `${prefix}/session/send`) {
        const raw = await readLimitedBody(ctx.req, ctx.maxBodyBytes);
        const body = parseJsonBody(raw) as Record<string, unknown>;
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const text = typeof body.text === "string" ? body.text : "";
        if (!sessionId || !text) {
          return write(400, { error: { code: "schema", message: "missing fields: sessionId, text" } });
        }
        const events = await deps.sessions.sendMessage(sessionId, text);
        return write(200, { sessionId, events });
      }

      if (ctx.method === "GET" && path === `${prefix}/session/list`) {
        return write(200, deps.sessions.list());
      }

      if (ctx.method === "GET" && path === `${prefix}/models`) {
        const models = deps.listModels
          ? await deps.listModels()
          : SIDECAR_MODELS.map((m) => ({ id: m.id, displayName: m.displayName }));
        return write(200, { models });
      }

      if (ctx.method === "POST" && path === `${prefix}/generate/queue`) {
        if (!deps.studio) {
          return write(503, { error: { code: "unavailable", message: "generation queue is not available" } });
        }
        const raw = await readLimitedBody(ctx.req, ctx.maxBodyBytes);
        const body = parseJsonBody(raw) as Record<string, unknown>;
        const pillar = body.pillar === "video" ? "video" : body.pillar === "image" ? "image" : null;
        const jobType = typeof body.jobType === "string" ? body.jobType : "";
        const parameters =
          body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
            ? (body.parameters as Record<string, unknown>)
            : null;
        if (!pillar || !jobType || !parameters) {
          return write(400, {
            error: { code: "schema", message: "missing fields: pillar, jobType, parameters" },
          });
        }
        const job = deps.studio.queue.enqueue({
          id: typeof body.id === "string" ? body.id : `cli-${Date.now().toString(36)}`,
          pillar,
          jobType,
          parameters,
          priority: "batch",
          threadId: typeof body.threadId === "string" ? body.threadId : undefined,
        });
        return write(200, { jobs: [job] });
      }

      if (ctx.method === "GET" && pathOnly(ctx.path) === `${prefix}/generate/status`) {
        if (!deps.studio) {
          return write(503, { error: { code: "unavailable", message: "generation queue is not available" } });
        }
        const id = queryId(ctx.path);
        if (!id) return write(400, { error: { code: "schema", message: "missing fields: id" } });
        const job = deps.studio.queue.get(id);
        return write(200, { job: job ?? null });
      }

      return write(404, { error: { code: "unknown_route", message: `No JSON CLI route for ${ctx.method} ${path}` } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return write(400, { error: { code: "sidecar", message } });
    }
  };
}
