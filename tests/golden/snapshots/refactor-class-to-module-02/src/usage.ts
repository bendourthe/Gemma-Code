import { Logger } from "./logger.js";

export function run(): void {
  Logger.info("starting");
  Logger.warn("careful");
  Logger.error("oops");
}
