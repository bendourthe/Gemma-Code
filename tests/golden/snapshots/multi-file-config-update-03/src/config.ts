export interface Settings {
  host: string;
  port: number;
  retries: number;
}

export const DEFAULT_SETTINGS: Settings = {
  host: "localhost",
  port: 8080,
  retries: 3,
};
