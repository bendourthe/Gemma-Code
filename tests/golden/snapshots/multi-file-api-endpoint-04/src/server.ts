import { handleHealth } from "./routes/health.js";
import { handleUsers } from "./routes/users.js";

export type Request = { path: string };
export type Response = { status: number; body: unknown };

export function route(req: Request): Response {
  if (req.path === "/health") return handleHealth();
  if (req.path === "/users") return handleUsers();
  return { status: 404, body: { error: "not found" } };
}
