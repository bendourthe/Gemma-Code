import type { Response } from "../server.js";

export function handleHealth(): Response {
  return { status: 200, body: { status: "ok" } };
}
