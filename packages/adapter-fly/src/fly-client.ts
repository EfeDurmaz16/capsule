import { AdapterExecutionError } from "@capsule/core";

export interface FlyClientOptions {
  apiToken?: string;
  appName?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface FlyRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
}

export class FlyClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FlyClientOptions = {}) {
    const apiToken = options.apiToken ?? process.env.FLY_API_TOKEN;
    if (!apiToken) {
      throw new AdapterExecutionError("Fly adapter requires an API token. Pass apiToken or set FLY_API_TOKEN.");
    }
    this.apiToken = apiToken;
    this.baseUrl = options.baseUrl ?? "https://api.machines.dev";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async request<T>(options: FlyRequestOptions): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiToken}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : `Fly API request failed with status ${response.status}`;
      throw new AdapterExecutionError(message, { status: response.status, data });
    }
    return data as T;
  }
}
