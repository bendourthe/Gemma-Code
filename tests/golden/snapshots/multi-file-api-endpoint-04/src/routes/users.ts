import type { Response } from "../server.js";

export function handleUsers(): Response {
  return { status: 200, body: [{ id: 1, name: "root" }] };
}
