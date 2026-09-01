import { ipc, type IpcReply } from "../../lib/ipc";

export interface MediaRuntimeState {
  readonly state: "ready" | "repairable" | "repairing" | "failed";
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly progress: number;
  readonly details?: string;
  readonly logPath: string;
}

export interface MediaRuntimeClient {
  status(): Promise<MediaRuntimeState>;
  repair(): Promise<MediaRuntimeState>;
  cancelRepair(): Promise<MediaRuntimeState>;
  openLogLocation(): Promise<boolean>;
}

function unwrap<T>(reply: IpcReply<T>): T {
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

export function createIpcMediaRuntimeClient(): MediaRuntimeClient {
  return {
    async status() {
      return unwrap(await ipc.call<MediaRuntimeState>("diffusion.runtime.status", {}));
    },
    async repair() {
      return unwrap(await ipc.call<MediaRuntimeState>("diffusion.runtime.repair", {}));
    },
    async cancelRepair() {
      return unwrap(await ipc.call<MediaRuntimeState>("diffusion.runtime.cancelRepair", {}));
    },
    async openLogLocation() {
      return unwrap(await ipc.call<{ opened: boolean }>("diffusion.runtime.openLogLocation", {})).opened;
    },
  };
}

export function isMediaRuntimeFailure(message: string): boolean {
  const value = message.toLowerCase();
  return (
    value.includes("runtime-unavailable") ||
    value.includes("runtime is not ready") ||
    value.includes("cuda torch") ||
    value.includes("diffusion runtime") ||
    value.includes("encoder_unavailable")
  );
}
