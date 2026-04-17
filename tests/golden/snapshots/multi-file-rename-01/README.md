# multi-file-rename-01

Three-file TypeScript project demonstrating a common cross-file rename.

## Task

Rename the function `processData` to `transformPayload` across all three files and update every call site.

## Layout

```
src/
  utils.ts     defines processData
  service.ts   imports and calls processData
  index.ts     imports and calls processData
```

## Success

- Function is renamed in `utils.ts`.
- All imports and call sites in `service.ts` and `index.ts` are updated.
- `npx tsc --noEmit` exits 0.
- No lingering `processData` occurrences.
