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

export interface FlyClientOptions extends HttpLimitOptions {
  apiToken?: string;
  appName?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface FlyRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class FlyClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limits: HttpLimits;

  constructor(options: FlyClientOptions = {}) {
    const apiToken = options.apiToken ?? process.env.FLY_API_TOKEN;
    if (!apiToken) {
      throw new AdapterExecutionError("Fly adapter requires an API token. Pass apiToken or set FLY_API_TOKEN.");
    }
    this.apiToken = apiToken;
    this.baseUrl = options.baseUrl ?? "https://api.machines.dev";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.limits = resolveHttpLimits(options);
  }

  async request<T>(options: FlyRequestOptions): Promise<T> {
    const url = new URL(options.path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetchWithinLimits({
      provider: "Fly",
      fetchImpl: this.fetchImpl,
      url: url.toString(),
      limits: this.limits,
      init: {
        method: options.method ?? "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiToken}`,
          ...(options.body === undefined ? {} : { "content-type": "application/json" })
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      }
    });
    if (!response.ok) {
      const data = parseErrorJson(response) as { error?: unknown; message?: unknown } | undefined;
      const message =
        typeof data?.error === "string"
          ? data.error
          : typeof data?.message === "string"
            ? data.message
            : `Fly API request failed with status ${response.status}`;
      throw providerExecutionError(message, httpErrorClassification(response, data), {
        status: response.status,
        ...(data === undefined ? errorBodyDiagnostics(response) : { data })
      });
    }
    return parseSuccessJson("Fly", response) as T;
  }
}
