# multi-file-add-import-02

Add a new `subtract` helper to `utils.ts` and wire it into two existing callers. The repository currently has only `add` in utils.

## Layout

```
src/
  utils.ts     exports add
  service.ts   imports add
  main.ts      imports add
```

## Success

- `utils.ts` exports `subtract(a, b)`.
- Both `service.ts` and `main.ts` import and call `subtract`.
- `npx tsc --noEmit` exits 0.
