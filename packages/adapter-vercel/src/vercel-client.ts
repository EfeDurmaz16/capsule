import { AdapterExecutionError } from "@capsule/core";

export interface VercelClientOptions {
  token?: string;
  teamId?: string;
  slug?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface CreateDeploymentInput {
  name: string;
  project?: string;
  target?: "production" | "staging" | "preview" | string;
  files: Array<{ file: string; data: string; encoding?: "utf-8" | "base64" }>;
  meta?: Record<string, string>;
}

export interface VercelDeploymentResponse {
  id: string;
  name?: string;
  url?: string;
  readyState?: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED" | string;
  inspectorUrl?: string;
  createdAt?: number;
}

export interface VercelAliasResponse {
  uid: string;
  alias: string;
  created?: string;
  oldDeploymentId?: string | null;
}

export interface VercelDeploymentEvent {
  type?: string;
  created?: number;
  payload?: {
    text?: string;
    message?: string;
    created?: number;
    date?: number;
    statusCode?: number;
    deploymentId?: string;
    id?: string;
    info?: {
      type?: string;
      name?: string;
      step?: string;
      readyState?: string;
    };
  };
}

export interface VercelRuntimeLog {
  level?: string;
  message?: string;
  rowId?: string;
  source?: string;
  timestampInMs?: number;
  domain?: string;
  messageTruncated?: boolean;
  requestMethod?: string;
  requestPath?: string;
  responseStatusCode?: number;
}

export class VercelClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VercelClientOptions = {}) {
    const token = options.token ?? process.env.VERCEL_TOKEN;
    if (!token) {
      throw new AdapterExecutionError("Vercel adapter requires a token. Pass token or set VERCEL_TOKEN.");
    }
    this.token = token;
    this.baseUrl = options.baseUrl ?? "https://api.vercel.com";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async createDeployment(input: CreateDeploymentInput): Promise<VercelDeploymentResponse> {
    return await this.request<VercelDeploymentResponse>({
      method: "POST",
      path: "/v13/deployments",
      body: {
        name: input.name,
        project: input.project,
        target: input.target,
        files: input.files,
        meta: input.meta
      }
    });
  }

  async getDeployment(idOrUrl: string): Promise<VercelDeploymentResponse> {
    return await this.request<VercelDeploymentResponse>({ method: "GET", path: `/v13/deployments/${encodeURIComponent(idOrUrl)}` });
  }

  async getDeploymentEvents(input: {
    idOrUrl: string;
    since?: number;
    until?: number;
    limit?: number;
    follow?: boolean;
  }): Promise<VercelDeploymentEvent[]> {
    return await this.request<VercelDeploymentEvent[]>({
      method: "GET",
      path: `/v3/deployments/${encodeURIComponent(input.idOrUrl)}/events`,
      query: {
        ...(input.since === undefined ? {} : { since: String(input.since) }),
        ...(input.until === undefined ? {} : { until: String(input.until) }),
        ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
        ...(input.follow === undefined ? {} : { follow: input.follow ? "1" : "0" })
      }
    });
  }

  async getRuntimeLogs(input: { projectId: string; deploymentId: string }): Promise<VercelRuntimeLog[]> {
    const data = await this.request<VercelRuntimeLog | VercelRuntimeLog[]>({
      method: "GET",
      path: `/v1/projects/${encodeURIComponent(input.projectId)}/deployments/${encodeURIComponent(input.deploymentId)}/runtime-logs`
    });
    return Array.isArray(data) ? data : [data];
  }

  async assignAlias(id: string, input: { alias: string; redirect?: string | null }): Promise<VercelAliasResponse> {
    return await this.request<VercelAliasResponse>({
      method: "POST",
      path: `/v2/deployments/${encodeURIComponent(id)}/aliases`,
      body: { alias: input.alias, redirect: input.redirect ?? null }
    });
  }

  private async request<T>(input: {
    method: "GET" | "POST";
    path: string;
    query?: Record<string, string>;
    body?: unknown;
  }): Promise<T> {
    const url = new URL(`${this.baseUrl}${input.path}`);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      url.searchParams.set(key, value);
    }
    if (this.options.teamId) url.searchParams.set("teamId", this.options.teamId);
    if (this.options.slug) url.searchParams.set("slug", this.options.slug);
    const response = await this.fetchImpl(url, {
      method: input.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...(input.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message =
        typeof data?.error?.message === "string"
          ? data.error.message
          : typeof data?.message === "string"
            ? data.message
            : `Vercel API request failed with status ${response.status}`;
      throw new AdapterExecutionError(message, { status: response.status, error: data?.error });
    }
    return data as T;
  }
}
