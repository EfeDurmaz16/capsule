import { AdapterExecutionError, providerExecutionError } from "@capsule-sdk/core";
import {
  errorBodyDiagnostics,
  fetchWithinLimits,
  httpErrorClassification,
  parseErrorJson,
  parseSuccessJson,
  resolveHttpLimits,
  type HttpLimitOptions,
  type HttpLimits
} from "./http-response.js";

export interface NeonClientOptions extends HttpLimitOptions {
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
  private readonly limits: HttpLimits;

  constructor(options: NeonClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.NEON_API_KEY;
    if (!apiKey) {
      throw new AdapterExecutionError("Neon adapter requires an API key. Pass apiKey or set NEON_API_KEY.");
    }
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? "https://console.neon.tech/api/v2";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.limits = resolveHttpLimits(options);
  }

  async request<T>(options: NeonRequestOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetchWithinLimits({
      provider: "Neon",
      fetchImpl: this.fetchImpl,
      url,
      limits: this.limits,
      init: {
        method: options.method ?? "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...(options.body === undefined ? {} : { "content-type": "application/json" })
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      }
    });

    if (!response.ok) {
      const data = parseErrorJson(response) as { message?: unknown; error?: unknown } | undefined;
      const message =
        typeof data?.message === "string"
          ? data.message
          : typeof data?.error === "string"
            ? data.error
            : `Neon API request failed with status ${response.status}`;
      throw providerExecutionError(message, httpErrorClassification(response, data), {
        status: response.status,
        ...(data === undefined ? errorBodyDiagnostics(response) : { data })
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return parseSuccessJson("Neon", response) as T;
  }
}
