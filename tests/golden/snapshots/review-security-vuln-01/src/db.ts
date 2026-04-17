export interface Row {
  id: number;
  name: string;
}

export interface Connection {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
}

export async function getUserByName(
  conn: Connection,
  name: string
): Promise<Row | null> {
  // VULNERABILITY: SQL injection via string concatenation
  const sql = "SELECT id, name FROM users WHERE name = '" + name + "'";
  const rows = await conn.query(sql);
  return rows[0] ?? null;
}
