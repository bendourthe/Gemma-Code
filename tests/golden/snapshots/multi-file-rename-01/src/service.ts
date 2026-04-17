import { processData, Payload } from "./utils.js";

export function handle(input: Payload): Payload {
  return processData(input);
}
