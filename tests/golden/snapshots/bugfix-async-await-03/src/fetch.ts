async function fetchRemote(): Promise<string> {
  return "hello";
}

// BUG: missing await - returns Promise<string> wrapped unnecessarily
export async function loadMessage(): Promise<string> {
  const msg = fetchRemote();
  return msg as unknown as string;
}
