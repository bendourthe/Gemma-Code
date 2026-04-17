# bugfix-off-by-one-01

`src/process.ts` iterates with `i <= arr.length`, off by one. Fix the condition.
