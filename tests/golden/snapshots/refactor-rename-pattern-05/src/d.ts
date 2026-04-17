import { greet } from "./a.js";
import { repeat } from "./b.js";
import { ready } from "./c.js";

export function main(): void {
  const strName = "world";
  const intCount = 2;
  const boolReady = true;
  console.log(greet(strName), repeat(strName, intCount), ready(boolReady));
}
