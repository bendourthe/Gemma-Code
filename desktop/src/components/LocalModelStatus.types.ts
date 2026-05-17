// Data contract for the Local Model Status widget. The same shape is consumed
// by the Dashboard widget and by future module-internal hardware-watch panels.

export interface LocalModelTelemetry {
  modelName: string;
  paramSize: string;
  gpuPct: number;
  vramFreeGB: number;
  deviceName: string;
  lastUpdated: number;
}

export type TelemetrySubscriber = (sample: LocalModelTelemetry) => void;

export interface TelemetryStream {
  subscribe(fn: TelemetrySubscriber): () => void;
}
