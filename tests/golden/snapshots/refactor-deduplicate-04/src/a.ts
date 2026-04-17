export function processA(input: string): string {
  let s = input;
  s = s.trim();
  s = s.toLowerCase();
  s = s.replace(/\s+/g, " ");
  s = s.replace(/[^a-z0-9 ]/g, "");
  return `a:${s}`;
}
