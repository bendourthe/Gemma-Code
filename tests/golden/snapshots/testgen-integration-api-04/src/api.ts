export interface User {
  id: string;
  name: string;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
}

export interface Request {
  path: string;
}

export interface Response {
  status: number;
  body: unknown;
}

export async function handle(
  repo: UserRepository,
  req: Request
): Promise<Response> {
  const match = /^\/users\/([^/]+)$/.exec(req.path);
  if (!match) return { status: 404, body: { error: "not found" } };
  const user = await repo.findById(match[1]);
  if (!user) return { status: 404, body: { error: "no such user" } };
  return { status: 200, body: user };
}
