export interface HttpClient {
  get(url: string): Promise<{ status: number; body: unknown }>;
}

export async function getTemperature(
  client: HttpClient,
  city: string
): Promise<number> {
  const response = await client.get(`https://api.example.com/weather/${city}`);
  if (response.status !== 200) {
    throw new Error(`upstream failed: ${response.status}`);
  }
  const body = response.body as { temperature?: number };
  if (typeof body.temperature !== "number") {
    throw new Error("invalid body");
  }
  return body.temperature;
}
