export function findDuplicates(items: readonly string[]): string[] {
  const duplicates: string[] = [];
  // BAD: O(n^2)
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i] === items[j] && !duplicates.includes(items[i]!)) {
        duplicates.push(items[i]!);
      }
    }
  }
  return duplicates;
}
