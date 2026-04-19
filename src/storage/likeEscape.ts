/**
 * Escape SQLite LIKE wildcards so user input is matched literally.
 * Pair with `... LIKE ? ESCAPE '\\'` in the SQL statement.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => "\\" + ch);
}
