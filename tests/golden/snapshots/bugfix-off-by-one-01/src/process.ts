export function sum(arr: number[]): number {
  let total = 0;
  // BUG: i <= arr.length causes an out-of-bounds access at arr[arr.length]
  for (let i = 0; i <= arr.length; i++) {
    total += arr[i] ?? 0;
  }
  return total;
}
