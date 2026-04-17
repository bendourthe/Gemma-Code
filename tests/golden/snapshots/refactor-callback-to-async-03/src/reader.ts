type Callback<T> = (err: Error | null, value?: T) => void;

function readRaw(path: string, callback: Callback<string>): void {
  setTimeout(() => callback(null, `contents of ${path}`), 1);
}

function parse(data: string, callback: Callback<string[]>): void {
  setTimeout(() => callback(null, data.split(" ")), 1);
}

function transform(tokens: string[], callback: Callback<string>): void {
  setTimeout(() => callback(null, tokens.join("-")), 1);
}

// Callback hell: nested callbacks with one error path per level.
export function readAndProcess(
  path: string,
  callback: Callback<string>
): void {
  readRaw(path, (err1, raw) => {
    if (err1 || raw === undefined) return callback(err1 ?? new Error("no raw"));
    parse(raw, (err2, tokens) => {
      if (err2 || tokens === undefined) return callback(err2 ?? new Error("no tokens"));
      transform(tokens, (err3, out) => {
        if (err3 || out === undefined) return callback(err3 ?? new Error("no out"));
        callback(null, out);
      });
    });
  });
}
