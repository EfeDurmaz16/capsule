import {
  AdapterExecutionError,
  UnknownOutcomeError,
  classifyProviderError,
  observeUntilTerminal,
  providerErrorStatus,
  providerExecutionError,
  readBoundedText,
  type ResourceLocator
} from "@capsule-sdk/core";

export interface AzureContainerAppsClientOptions {
  accessToken?: string;
  subscriptionId?: string;
  resourceGroupName?: string;
  apiVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Client-side timeout for one HTTP request, including reading its body. Default 60000. */
  requestTimeoutMs?: number;
  /** Largest successful response body Capsule reads, in bytes. Default 33554432 (32 MiB). */
  maxResponseBytes?: number;
  /**
   * Client-side budget for observing an accepted asynchronous ARM operation (HTTP 202) to completion.
   * Default 300000. When it expires the operation is reported as pending, never as completed.
   */
  operationDeadlineMs?: number;
  /** Delay between ARM operation polls. Defaults to the provider Retry-After value, else 2000. */
  operationPollIntervalMs?: number;
}

export interface AzureContainerAppsRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** ARM response with the status and asynchronous-operation headers kept. */
export interface AzureContainerAppsResponse<T> {
  status: number;
  data: T | undefined;
  /** Azure-AsyncOperation polling URL, when ARM returned one. */
  asyncOperationUrl?: string;
  /** Location polling URL, when ARM returned one. */
  locationUrl?: string;
  retryAfterMs?: number;
}

/** Terminal outcome of an observed ARM delete. */
export type AzureDeleteOutcome = "deleted" | "already-absent";

const maxErrorBodyBytes = 64 * 1024;

export class AzureContainerAppsClient {
  readonly subscriptionId: string;
  readonly resourceGroupName: string;
  readonly apiVersion: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AzureContainerAppsClientOptions = {}) {
    const accessToken = options.accessToken ?? process.env.AZURE_ACCESS_TOKEN;
    const subscriptionId = options.subscriptionId ?? process.env.AZURE_SUBSCRIPTION_ID;
    const resourceGroupName = options.resourceGroupName ?? process.env.AZURE_RESOURCE_GROUP;
    if (!accessToken) throw new AdapterExecutionError("Azure Container Apps adapter requires accessToken or AZURE_ACCESS_TOKEN.");
    if (!subscriptionId) throw new AdapterExecutionError("Azure Container Apps adapter requires subscriptionId or AZURE_SUBSCRIPTION_ID.");
    if (!resourceGroupName) throw new AdapterExecutionError("Azure Container Apps adapter requires resourceGroupName or AZURE_RESOURCE_GROUP.");
    this.accessToken = accessToken;
    this.subscriptionId = subscriptionId;
    this.resourceGroupName = resourceGroupName;
    this.apiVersion = options.apiVersion ?? "2025-07-01";
    this.baseUrl = options.baseUrl ?? "https://management.azure.com";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  resourcePath(kind: "containerApps" | "jobs", name: string, suffix = ""): string {
    return `/subscriptions/${encodeURIComponent(this.subscriptionId)}/resourceGroups/${encodeURIComponent(this.resourceGroupName)}/providers/Microsoft.App/${kind}/${encodeURIComponent(name)}${suffix}?api-version=${encodeURIComponent(this.apiVersion)}`;
  }

  jobExecutionPath(jobName: string, executionName: string, suffix = ""): string {
    return this.resourcePath("jobs", jobName, `/executions/${encodeURIComponent(executionName)}${suffix}`);
  }

  async request<T>(options: AzureContainerAppsRequestOptions): Promise<T> {
    return (await this.send<T>(options)).data as T;
  }

  /**
   * Status-first, bounded ARM request. The HTTP status is checked before any JSON parsing, so a gateway
   * HTML error keeps its status and retry classification. Bodies are read through a byte cap and the
   * whole exchange, including the body, runs under a client timeout. Status and asynchronous-operation
   * headers are returned so callers can tell 200 (done), 202 (accepted, in progress) and 204 apart.
   */
  async send<T>(options: AzureContainerAppsRequestOptions & { url?: string }): Promise<AzureContainerAppsResponse<T>> {
    const method = options.method ?? "GET";
    const url = options.url ?? `${this.baseUrl}${options.path}`;
    const timeoutMs = this.options.requestTimeoutMs ?? 60_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const describe = `Azure Container Apps ${method} ${new URL(url).pathname}`;
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.accessToken}`,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...options.headers
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal
      });
      if (!response.ok) {
        const { text } = await readBoundedText(response, maxErrorBodyBytes);
        const data = parseJson(text) as { error?: { message?: unknown } } | undefined;
        const message =
          typeof data?.error?.message === "string" ? data.error.message : `Azure Container Apps API request failed with status ${response.status}`;
        const providerError = classifyProviderError({ status: response.status, headers: response.headers, error: data });
        throw providerExecutionError(message, providerError, {
          status: response.status,
          data
        });
      }
      const maxBytes = this.options.maxResponseBytes ?? 32 * 1024 * 1024;
      const { text, truncation } = await readBoundedText(response, maxBytes);
      if (truncation.truncated) {
        throw new AdapterExecutionError(`${describe} response exceeded ${maxBytes} bytes and was not parsed.`, { status: response.status, truncation });
      }
      const data = parseJson(text);
      if (text && data === undefined) {
        throw new AdapterExecutionError(`${describe} returned a body that is not valid JSON.`, { status: response.status });
      }
      const retryAfter = Number(response.headers.get("retry-after") ?? Number.NaN);
      return {
        status: response.status,
        data: data as T | undefined,
        ...optional("asyncOperationUrl", response.headers.get("azure-asyncoperation")),
        ...optional("locationUrl", response.headers.get("location")),
        ...(Number.isFinite(retryAfter) && retryAfter >= 0 ? { retryAfterMs: retryAfter * 1000 } : {})
      };
    } catch (error) {
      if (signal.aborted && !(error instanceof AdapterExecutionError)) {
        throw method === "GET"
          ? providerExecutionError(`${describe} did not complete within ${timeoutMs}ms.`, { category: "retryable", retryable: true }, { timeoutMs, error })
          : new UnknownOutcomeError(
              `${describe} did not complete within ${timeoutMs}ms; ARM may or may not have applied it. Observe the resource before retrying.`,
              { operation: describe },
              error
            );
      }
      throw error;
    }
  }

  /**
   * Deletes an ARM resource and returns only once the deletion is known to be finished. 200 means
   * deleted and 204 means the resource did not exist. 202 means accepted and still in progress: the
   * operation is polled through Azure-AsyncOperation or Location (only on the configured ARM origin,
   * so the bearer token is never sent elsewhere), or else the resource is read until it returns 404.
   * When operationDeadlineMs expires it throws PendingOperationError; an operation that ended Failed
   * or Canceled throws.
   */
  async deleteAndObserve(path: string, target: { operation: string; resource: ResourceLocator }): Promise<AzureDeleteOutcome> {
    const accepted = await this.send<unknown>({ method: "DELETE", path });
    if (accepted.status === 204) return "already-absent";
    if (accepted.status !== 202) return "deleted";
    const asyncOperationUrl = this.sameOrigin(accepted.asyncOperationUrl);
    const locationUrl = this.sameOrigin(accepted.locationUrl);
    await observeUntilTerminal<void>(
      async ({ signal }) => {
        if (asyncOperationUrl) {
          const polled = await this.send<{ status?: string; error?: { message?: string } }>({ url: asyncOperationUrl, path: "", signal });
          const status = polled.data?.status;
          if (status === "Succeeded") return { done: true, value: undefined };
          if (status === "Failed" || status === "Canceled") {
            return {
              done: "failed",
              error: new AdapterExecutionError(
                `${target.operation} for ${target.resource.nativeId} ended ${status}: ${polled.data?.error?.message ?? "no detail"}`,
                { operation: polled.data }
              )
            };
          }
          return { done: false, state: status ?? "unknown" };
        }
        if (locationUrl) {
          const polled = await this.send<unknown>({ url: locationUrl, path: "", signal });
          return polled.status === 202 ? { done: false, state: "InProgress" } : { done: true, value: undefined };
        }
        try {
          const resource = await this.send<{ properties?: { provisioningState?: string } }>({ path, signal });
          return { done: false, state: resource.data?.properties?.provisioningState ?? "present" };
        } catch (error) {
          if (providerErrorStatus(error) === 404) return { done: true, value: undefined };
          throw error;
        }
      },
      {
        operation: target.operation,
        resource: target.resource,
        deadlineMs: this.options.operationDeadlineMs ?? 300_000,
        intervalMs: this.options.operationPollIntervalMs ?? Math.min(accepted.retryAfterMs ?? 2_000, 30_000)
      }
    );
    return "deleted";
  }

  private sameOrigin(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
      return new URL(url).origin === new URL(this.baseUrl).origin ? url : undefined;
    } catch {
      return undefined;
    }
  }
}

function optional<K extends string>(key: K, value: string | null): Partial<Record<K, string>> {
  return value ? ({ [key]: value } as Record<K, string>) : {};
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
