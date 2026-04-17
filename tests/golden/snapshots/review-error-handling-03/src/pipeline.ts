async function fetchRaw(): Promise<string> {
  return "raw";
}
async function parse(input: string): Promise<string[]> {
  if (!input) throw new Error("empty");
  return input.split(" ");
}
async function publish(tokens: string[]): Promise<number> {
  if (tokens.length === 0) throw new Error("nothing to publish");
  return tokens.length;
}

// No error handling: any failure propagates and crashes the caller.
export async function runPipeline(): Promise<number> {
  const raw = await fetchRaw();
  const tokens = await parse(raw);
  const count = await publish(tokens);
  return count;
}
