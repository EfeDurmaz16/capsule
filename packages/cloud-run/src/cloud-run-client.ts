import { GoogleAuth } from "google-auth-library";
import {
  AdapterExecutionError,
  PendingOperationError,
  UnknownOutcomeError,
  classifyProviderError,
  observeUntilTerminal,
  providerExecutionError,
  readBoundedText,
  resourceLocator,
  type ResourceLocator
} from "@capsule-sdk/core";

export interface CloudRunClientOptions {
  projectId?: string;
  /**
   * Numeric project number that Cloud Run may use in place of projectId in full resource names. Full
   * names whose project is neither projectId nor this value are rejected before any request.
   */
  projectNumber?: string;
  location?: string;
  accessToken?: string;
  baseUrl?: string;
  loggingBaseUrl?: string;
  fetch?: typeof fetch;
  /**
   * When false, Capsule does not call operations.wait for run, deploy, update, rollback and delete
   * operations. A delete that is not already done then throws PendingOperationError instead of
   * reporting deleted. Job creation is always awaited because :run requires the Job to exist.
   */
  waitForOperations?: boolean;
  /** Server-side timeout sent with each operations.wait call. Default 300000. It is not a client deadline. */
  operationTimeoutMs?: number;
  /**
   * Client-side budget for observing a long-running operation to completion, across every
   * operations.wait call and its HTTP lifetime. Default operationTimeoutMs, else 300000.
   */
  operationDeadlineMs?: number;
  /** Delay between operations.wait calls when a wait returns before the operation is done. Default 1000. */
  operationPollIntervalMs?: number;
  /** Client-side timeout for one HTTP request, including reading its body. Default 60000. */
  requestTimeoutMs?: number;
  /** Largest successful response body Capsule reads, in bytes. Default 33554432 (32 MiB). */
  maxResponseBytes?: number;
}

export interface CloudRunOperation<T = unknown> {
  name: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: T;
  metadata?: Record<string, unknown>;
}

export interface CloudRunExecution {
  name: string;
  completionStatus?:
    "COMPLETION_STATUS_UNSPECIFIED" | "EXECUTION_SUCCEEDED" | "EXECUTION_FAILED" | "EXECUTION_RUNNING" | "EXECUTION_PENDING" | "EXECUTION_CANCELLED";
  reconciling?: boolean;
  runningCount?: number;
  succeededCount?: number;
  failedCount?: number;
  cancelledCount?: number;
  taskCount?: number;
  logUri?: string;
  deleteTime?: string;
}

export interface CloudRunCondition {
  type?: string;
  state?: "CONDITION_STATE_UNSPECIFIED" | "CONDITION_PENDING" | "CONDITION_RECONCILING" | "CONDITION_FAILED" | "CONDITION_SUCCEEDED";
  message?: string;
  reason?: string;
}

export interface CloudRunService {
  name: string;
  uri?: string;
  reconciling?: boolean;
  terminalCondition?: CloudRunCondition;
  conditions?: CloudRunCondition[];
  latestReadyRevision?: string;
  latestCreatedRevision?: string;
  traffic?: CloudRunTrafficTarget[];
  trafficStatuses?: CloudRunTrafficTarget[];
  deleteTime?: string;
}

export interface CloudRunTrafficTarget {
  type?: "TRAFFIC_TARGET_ALLOCATION_TYPE_UNSPECIFIED" | "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" | "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION";
  revision?: string;
  percent?: number;
  tag?: string;
  uri?: string;
}

export interface CloudRunRevision {
  name: string;
  service?: string;
  createTime?: string;
  deleteTime?: string;
}

export interface CloudRunListRevisionsResponse {
  revisions?: CloudRunRevision[];
  nextPageToken?: string;
}

export interface CloudLoggingEntry {
  logName?: string;
  resource?: {
    type?: string;
    labels?: Record<string, string>;
  };
  timestamp?: string;
  receiveTimestamp?: string;
  severity?: string;
  textPayload?: string;
  jsonPayload?: unknown;
  protoPayload?: unknown;
  labels?: Record<string, string>;
}

export interface CloudLoggingListEntriesRequest {
  resourceNames: string[];
  filter: string;
  orderBy?: string;
  pageSize?: number;
  pageToken?: string;
}

export interface CloudLoggingListEntriesResponse {
  entries?: CloudLoggingEntry[];
  nextPageToken?: string;
}

export class CloudRunClient {
  readonly projectId: string;
  readonly location: string;
  private readonly baseUrl: string;
  private readonly loggingBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly accessToken?: string;

  constructor(private readonly options: CloudRunClientOptions = {}) {
    if (!options.projectId) {
      throw new AdapterExecutionError("Cloud Run adapter requires projectId.");
    }
    if (!options.location) {
      throw new AdapterExecutionError("Cloud Run adapter requires location.");
    }
    this.projectId = options.projectId;
    this.location = options.location;
    this.baseUrl = options.baseUrl ?? "https://run.googleapis.com/v2";
    this.loggingBaseUrl = options.loggingBaseUrl ?? "https://logging.googleapis.com/v2";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.accessToken = options.accessToken;
  }

  parent(): string {
    return `projects/${this.projectId}/locations/${this.location}`;
  }

  resource(kind: "jobs" | "services", id: string): string {
    return `${this.parent()}/${kind}/${id}`;
  }

  async createJob(jobId: string, body: unknown): Promise<CloudRunOperation> {
    return await this.request<CloudRunOperation>({
      method: "POST",
      path: `/${this.parent()}/jobs`,
      query: { jobId },
      body
    });
  }

  async runJob(name: string): Promise<CloudRunOperation> {
    return await this.request<CloudRunOperation>({ method: "POST", path: `/${name}:run`, body: {} });
  }

  async getExecution(name: string): Promise<CloudRunExecution> {
    return await this.request<CloudRunExecution>({ path: `/${name}` });
  }

  /** executions.cancel returns a long-running Operation, not the Execution. */
  async cancelExecution(name: string): Promise<CloudRunOperation<CloudRunExecution>> {
    return await this.request<CloudRunOperation<CloudRunExecution>>({ method: "POST", path: `/${name}:cancel`, body: {} });
  }

  async deleteExecution(name: string): Promise<CloudRunOperation> {
    return await this.request<CloudRunOperation>({ method: "DELETE", path: `/${name}` });
  }

  async createService(serviceId: string, body: unknown): Promise<CloudRunOperation> {
    return await this.request<CloudRunOperation>({
      method: "POST",
      path: `/${this.parent()}/services`,
      query: { serviceId },
      body
    });
  }

  async getService(name: string): Promise<CloudRunService> {
    return await this.request<CloudRunService>({ path: `/${name}` });
  }

  async updateService(name: string, body: unknown, updateMask: string[], options: { forceNewRevision?: boolean } = {}): Promise<CloudRunOperation> {
    return await this.request<CloudRunOperation>({
      method: "PATCH",
      path: `/${name}`,
      query: { updateMask: updateMask.join(","), forceNewRevision: options.forceNewRevision },
      body
    });
  }

  async listRevisions(serviceName: string): Promise<CloudRunListRevisionsResponse> {
    return await this.request<CloudRunListRevisionsResponse>({ path: `/${serviceName}/revisions` });
  }

  async deleteService(name: string): Promise<CloudRunOperation> {
    return await this.request<CloudRunOperation>({ method: "DELETE", path: `/${name}` });
  }

  /**
   * One best-effort operations.wait call, for results that can report a transitional status. The
   * provider may return before the operation is done; callers must check `done`.
   */
  async waitOperation<T>(operation: CloudRunOperation<T>): Promise<CloudRunOperation<T>> {
    if (this.options.waitForOperations === false || operation.done) {
      return operation;
    }
    const serverWaitMs = this.options.operationTimeoutMs ?? 300_000;
    return await this.request<CloudRunOperation<T>>({
      method: "POST",
      path: `/${operation.name}:wait`,
      body: { timeout: waitTimeout(serverWaitMs) },
      idempotent: true,
      timeoutMs: serverWaitMs + waitGraceMs
    });
  }

  /**
   * Observes an accepted operation until it is done, with repeated best-effort operations.wait calls
   * inside one client-side deadline. Returns the done operation, which may carry `error`. Throws
   * PendingOperationError when the deadline expires or waiting is disabled; it never treats a
   * not-done operation as finished.
   */
  async awaitOperation<T>(
    operation: CloudRunOperation<T>,
    target: { operation: string; resource: ResourceLocator; always?: boolean }
  ): Promise<CloudRunOperation<T>> {
    if (operation.done) return operation;
    const resource = resourceLocator({ ...target.resource, scope: { ...target.resource.scope }, nativeOperationId: operation.name });
    if (this.options.waitForOperations === false && !target.always) {
      throw new PendingOperationError(
        `${target.operation} for ${resource.kind} ${resource.nativeId} was accepted and is not done; waitForOperations is false.`,
        { operation: target.operation, resource, state: "running" }
      );
    }
    const serverWaitMs = this.options.operationTimeoutMs ?? 300_000;
    return await observeUntilTerminal<CloudRunOperation<T>>(
      async ({ signal, remainingMs }) => {
        const waitMs = Math.min(serverWaitMs, remainingMs);
        const waited = await this.request<CloudRunOperation<T>>({
          method: "POST",
          path: `/${operation.name}:wait`,
          body: { timeout: waitTimeout(waitMs) },
          idempotent: true,
          signal,
          timeoutMs: waitMs + waitGraceMs
        });
        return waited.done ? { done: true, value: waited } : { done: false, state: "running" };
      },
      {
        operation: target.operation,
        resource,
        deadlineMs: this.options.operationDeadlineMs ?? this.options.operationTimeoutMs ?? 300_000,
        intervalMs: this.options.operationPollIntervalMs ?? 1_000
      }
    );
  }

  async listLogEntries(request: CloudLoggingListEntriesRequest): Promise<CloudLoggingListEntriesResponse> {
    return await this.request<CloudLoggingListEntriesResponse>({
      baseUrl: this.loggingBaseUrl,
      service: "Cloud Logging",
      method: "POST",
      path: "/entries:list",
      body: request,
      idempotent: true
    });
  }

  // Cached per client so the auth library's own token cache and refresh are reused across requests;
  // a failed lookup is not cached.
  private authClient?: ReturnType<GoogleAuth["getClient"]>;

  private async token(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    this.authClient ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
    let client: Awaited<ReturnType<GoogleAuth["getClient"]>>;
    try {
      client = await this.authClient;
    } catch (error) {
      this.authClient = undefined;
      throw error;
    }
    // getRequestHeaders refreshes an expired or expiring token before returning it.
    const headers = await client.getRequestHeaders();
    const authorization = headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new AdapterExecutionError("Cloud Run adapter could not resolve Google Cloud credentials.");
    }
    return authorization.slice("Bearer ".length);
  }

  // Status-first, bounded HTTP exchange. The status is checked before any JSON parsing, so a gateway
  // HTML 503 keeps its status and retry classification. Bodies are read through a byte cap and the
  // whole exchange, including the body, runs under a client timeout.
  private async request<T>(options: {
    baseUrl?: string;
    service?: string;
    method?: string;
    path: string;
    query?: Record<string, string | boolean | undefined>;
    body?: unknown;
    /** Safe to repeat: a timeout is reported as retryable rather than as an unknown outcome. */
    idempotent?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<T> {
    const service = options.service ?? "Cloud Run";
    const method = options.method ?? "GET";
    const url = new URL(`${options.baseUrl ?? this.baseUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 60_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const describe = `${service} ${method} ${url.pathname}`;
    const aborted = (error: unknown): Error =>
      method === "GET" || options.idempotent
        ? providerExecutionError(`${describe} did not complete within ${timeoutMs}ms.`, { category: "retryable", retryable: true }, { timeoutMs, error })
        : new UnknownOutcomeError(
            `${describe} did not complete within ${timeoutMs}ms; the provider may or may not have applied it. Observe the resource before retrying.`,
            { operation: describe },
            error
          );
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${await this.token()}`,
          ...(options.body === undefined ? {} : { "content-type": "application/json" })
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal
      });
      if (!response.ok) {
        const { text } = await readBoundedText(response, maxErrorBodyBytes);
        const data = parseJson(text);
        const record = data && typeof data === "object" ? (data as { error?: { message?: unknown }; message?: unknown }) : undefined;
        const message =
          typeof record?.error?.message === "string"
            ? record.error.message
            : typeof record?.message === "string"
              ? record.message
              : `${service} API request failed with status ${response.status}`;
        const providerError = classifyProviderError({ status: response.status, headers: response.headers, error: record?.error ?? record });
        throw providerExecutionError(message, providerError, {
          status: response.status,
          error: record?.error
        });
      }
      const maxBytes = this.options.maxResponseBytes ?? 32 * 1024 * 1024;
      const { text, truncation } = await readBoundedText(response, maxBytes);
      if (truncation.truncated) {
        throw new AdapterExecutionError(`${describe} response exceeded ${maxBytes} bytes and was not parsed.`, { status: response.status, truncation });
      }
      if (!text) return undefined as T;
      const data = parseJson(text);
      if (data === undefined) {
        throw new AdapterExecutionError(`${describe} returned a body that is not valid JSON.`, { status: response.status });
      }
      return data as T;
    } catch (error) {
      if (signal.aborted && !(error instanceof AdapterExecutionError)) throw aborted(error);
      throw error;
    }
  }
}

// Extra client time beyond the server-side wait, so the HTTP request outlives the wait it asked for.
const waitGraceMs = 15_000;
const maxErrorBodyBytes = 64 * 1024;

function waitTimeout(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
