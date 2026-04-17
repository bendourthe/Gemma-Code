export class Logger {
  static info(msg: string): void {
    console.log(`[INFO] ${msg}`);
  }
  static warn(msg: string): void {
    console.warn(`[WARN] ${msg}`);
  }
  static error(msg: string): void {
    console.error(`[ERROR] ${msg}`);
  }
}
