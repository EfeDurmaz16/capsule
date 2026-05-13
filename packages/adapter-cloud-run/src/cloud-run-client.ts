import { GoogleAuth } from "google-auth-library";
import { AdapterExecutionError } from "@capsule/core";

export interface CloudRunClientOptions {
  projectId?: string;
  location?: string;
  accessToken?: string;
  baseUrl?: string;
  loggingBaseUrl?: string;
  fetch?: typeof fetch;
  waitForOperations?: boolean;
  operationTimeoutMs?: number;
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
  completionStatus?: "COMPLETION_STATUS_UNSPECIFIED" | "EXECUTION_SUCCEEDED" | "EXECUTION_FAILED" | "EXECUTION_RUNNING" | "EXECUTION_PENDING" | "EXECUTION_CANCELLED";
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

  async cancelExecution(name: string): Promise<CloudRunExecution> {
    return await this.request<CloudRunExecution>({ method: "POST", path: `/${name}:cancel`, body: {} });
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

  async waitOperation<T>(operation: CloudRunOperation<T>): Promise<CloudRunOperation<T>> {
    if (this.options.waitForOperations === false || operation.done) {
      return operation;
    }
    return await this.request<CloudRunOperation<T>>({
      method: "POST",
      path: `/${operation.name}:wait`,
      body: { timeout: `${Math.ceil((this.options.operationTimeoutMs ?? 300_000) / 1000)}s` }
    });
  }

  async listLogEntries(request: CloudLoggingListEntriesRequest): Promise<CloudLoggingListEntriesResponse> {
    return await this.loggingRequest<CloudLoggingListEntriesResponse>({
      method: "POST",
      path: "/entries:list",
      body: request
    });
  }

  private async token(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();
    const headers = await client.getRequestHeaders();
    const authorization = headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new AdapterExecutionError("Cloud Run adapter could not resolve Google Cloud credentials.");
    }
    return authorization.slice("Bearer ".length);
  }

  private async request<T>(options: { method?: string; path: string; query?: Record<string, string | boolean | undefined>; body?: unknown }): Promise<T> {
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
        authorization: `Bearer ${await this.token()}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message =
        typeof data?.error?.message === "string"
          ? data.error.message
          : typeof data?.message === "string"
            ? data.message
            : `Cloud Run API request failed with status ${response.status}`;
      throw new AdapterExecutionError(message, { status: response.status, error: data?.error });
    }
    return data as T;
  }

  private async loggingRequest<T>(options: { method?: string; path: string; body?: unknown }): Promise<T> {
    const url = new URL(`${this.loggingBaseUrl}${options.path}`);
    const response = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${await this.token()}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message =
        typeof data?.error?.message === "string"
          ? data.error.message
          : typeof data?.message === "string"
            ? data.message
            : `Cloud Logging API request failed with status ${response.status}`;
      throw new AdapterExecutionError(message, { status: response.status, error: data?.error });
    }
    return data as T;
  }
}
