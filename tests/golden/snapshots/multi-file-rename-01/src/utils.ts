export interface Payload {
  id: string;
  value: number;
}

export function processData(payload: Payload): Payload {
  return { id: payload.id.trim(), value: payload.value * 2 };
}
