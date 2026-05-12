import { AdapterExecutionError } from "@capsule/core";

export interface NeonClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface NeonRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | boolean | number | undefined>;
  body?: unknown;
}

export class NeonClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NeonClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.NEON_API_KEY;
    if (!apiKey) {
      throw new AdapterExecutionError("Neon adapter requires an API key. Pass apiKey or set NEON_API_KEY.");
    }
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? "https://console.neon.tech/api/v2";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async request<T>(options: NeonRequestOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiKey}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      const message =
        typeof data?.message === "string"
          ? data.message
          : typeof data?.error === "string"
            ? data.error
            : `Neon API request failed with status ${response.status}`;
      throw new AdapterExecutionError(message, data);
    }

    return data as T;
  }
}
