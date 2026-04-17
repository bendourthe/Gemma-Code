export function validate(value: string): string {
  if (!value) throw new Error("empty");
  return value;
}
