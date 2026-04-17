# bugfix-async-await-03

`loadMessage` is declared `async` but forgets to `await` the inner promise, so its return value is `Promise<string>` instead of `string`.
