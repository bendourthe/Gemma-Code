let count = 0;

async function read(): Promise<number> {
  await new Promise((r) => setTimeout(r, 1));
  return count;
}

async function write(next: number): Promise<void> {
  await new Promise((r) => setTimeout(r, 1));
  count = next;
}

// BUG: read-modify-write without lock — two concurrent calls can both
// read the same value and overwrite each other's increment.
export async function increment(): Promise<number> {
  const current = await read();
  await write(current + 1);
  return current + 1;
}

export function reset(): void {
  count = 0;
}
